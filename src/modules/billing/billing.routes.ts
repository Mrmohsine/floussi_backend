import { Router } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, HttpError } from '../../utils/errors';
import {
  PLAN_LIMITS, PLAN_PRICES, isPlan, type Plan,
} from './plans';
import {
  getAiMessageUsage, getUserPlan, startOfMonth, nextMonth,
} from './enforce';

const router = Router();
router.use(requireAuth);

let _stripe: InstanceType<typeof Stripe> | null = null;
function stripe(): InstanceType<typeof Stripe> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(503, 'Payments are unavailable — backend is missing STRIPE_SECRET_KEY.');
  }
  if (!_stripe) _stripe = new Stripe(env.STRIPE_SECRET_KEY);
  return _stripe;
}

const upgradeSchema = z.object({
  plan: z.enum(['FREE', 'PRO', 'PREMIUM']),
});

const checkoutSchema = z.object({
  plan: z.enum(['PRO', 'PREMIUM']),
  // Optional — when provided, Stripe redirects here instead of the default
  // `paycheck://` scheme. Lets Expo Go (exp://...) work without rebuilding.
  successUrl: z.string().min(1).max(500).optional(),
  cancelUrl: z.string().min(1).max(500).optional(),
});

const verifySchema = z.object({
  sessionId: z.string().min(8).max(200),
});

router.get(
  '/plan',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const plan = await getUserPlan(userId);
    const limits = PLAN_LIMITS[plan];

    const start = startOfMonth();
    const end = nextMonth();

    const [
      expensesThisMonth,
      savingsGoals,
      debts,
      recurringBills,
      aiMessagesUsed,
    ] = await Promise.all([
      prisma.expense.count({ where: { userId, date: { gte: start, lt: end } } }),
      prisma.savingsGoal.count({ where: { userId, archivedAt: null } }),
      prisma.debt.count({ where: { userId } }),
      prisma.recurringBill.count({ where: { userId } }),
      getAiMessageUsage(userId),
    ]);

    res.json({
      plan,
      limits,
      usage: {
        expensesThisMonth,
        savingsGoals,
        debts,
        recurringBills,
        aiMessagesThisMonth: aiMessagesUsed,
      },
      pricing: PLAN_PRICES,
    });
  }),
);

// Direct flip — used for free downgrade and as a fallback admin/demo path.
// Real upgrades should go through the Stripe Checkout flow below.
router.post(
  '/upgrade',
  validate(upgradeSchema),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const target = (req.body.plan as Plan);
    if (!isPlan(target)) {
      res.status(400).json({ message: 'Invalid plan' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { plan: target, planSince: new Date() },
      select: {
        id: true, email: true, name: true, currency: true,
        paySchedule: true, plan: true, planSince: true,
      },
    });

    res.json({
      ok: true,
      plan: updated.plan,
      planSince: updated.planSince.toISOString(),
      user: updated,
    });
  }),
);

// Creates a Stripe Checkout Session for a paid plan.
// Mobile opens `url` in the system browser; Stripe redirects back to a
// deep link that the app handles. We don't trust the client — we verify
// status by retrieving the session directly from Stripe in /verify.
router.post(
  '/checkout-session',
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const target = req.body.plan as Exclude<Plan, 'FREE'>;
    const priceCents = Math.round(PLAN_PRICES[target] * 100);
    if (!priceCents) throw badRequest('Invalid plan price');

    const scheme = env.APP_DEEP_LINK_SCHEME;
    const successBase =
      (req.body.successUrl as string | undefined) ?? `${scheme}://upgrade-success`;
    const cancelBase =
      (req.body.cancelUrl as string | undefined) ?? `${scheme}://upgrade-cancel`;
    const sep = (u: string) => (u.includes('?') ? '&' : '?');

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      // Don't pre-fill email — that triggers Stripe Link's "Continue with Link"
      // page before the card form. We still tag the session with the user via
      // metadata, so verify-session can match it server-side.
      phone_number_collection: { enabled: false },
      billing_address_collection: 'auto',
      // Force the card form as the first thing the user sees.
      payment_method_options: {
        card: { setup_future_usage: undefined },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: priceCents,
            product_data: {
              name: `Paycheck ${target.charAt(0) + target.slice(1).toLowerCase()} plan`,
              description:
                target === 'PRO'
                  ? 'Unlock unlimited expenses, more AI messages, debts and recurring bills.'
                  : 'Unlock everything — AI memory, CSV export, full history.',
            },
          },
        },
      ],
      // Pass plan + userId as metadata so /verify can re-check them server-side.
      metadata: { userId, plan: target },
      // success_url MUST contain {CHECKOUT_SESSION_ID} so Stripe substitutes it.
      success_url: `${successBase}${sep(successBase)}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelBase,
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    });
  }),
);

// Mobile calls this after the browser redirects back. We retrieve the
// session from Stripe (server-to-server), confirm payment_status === 'paid',
// confirm the userId in metadata matches the caller, then flip the plan.
router.post(
  '/verify-session',
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const session = await stripe().checkout.sessions.retrieve(req.body.sessionId);

    if (session.metadata?.userId !== userId) {
      throw badRequest('Session does not belong to this user');
    }
    const targetPlan = session.metadata?.plan;
    if (!targetPlan || !isPlan(targetPlan) || targetPlan === 'FREE') {
      throw badRequest('Invalid plan in session');
    }

    if (session.payment_status !== 'paid') {
      res.status(402).json({
        ok: false,
        status: session.payment_status,
        message: 'Payment not completed.',
      });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { plan: targetPlan, planSince: new Date() },
      select: {
        id: true, email: true, name: true, currency: true,
        paySchedule: true, plan: true, planSince: true,
      },
    });

    res.json({
      ok: true,
      plan: updated.plan,
      planSince: updated.planSince.toISOString(),
      user: updated,
    });
  }),
);

export default router;
