import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  PLAN_LIMITS, PLAN_PRICES, isPlan, type Plan,
} from './plans';
import {
  getAiMessageUsage, getUserPlan, startOfMonth, nextMonth,
} from './enforce';

const router = Router();
router.use(requireAuth);

const upgradeSchema = z.object({
  plan: z.enum(['FREE', 'PRO', 'PREMIUM']),
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

export default router;
