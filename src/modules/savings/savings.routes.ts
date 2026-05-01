import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { toDecimal, toNumber } from '../../utils/money';
import { notFound } from '../../utils/errors';

const router = Router();
router.use(requireAuth);

const money = z.coerce.number().nonnegative().max(99_999_999);

const createSchema = z.object({
  name: z.string().min(1).max(60),
  type: z
    .enum([
      'EMERGENCY_FUND',
      'VACATION',
      'CAR_DOWN_PAYMENT',
      'HOUSE_DOWN_PAYMENT',
      'DEBT_PAYOFF',
      'OTHER',
    ])
    .default('OTHER'),
  targetAmount: money,
  savedAmount: money.default(0),
  targetDate: z.coerce.date().optional().nullable(),
  icon: z.string().max(40).default('piggy-bank'),
  color: z.string().regex(/^#?[0-9A-Fa-f]{6}$/).default('#10B981'),
});

const updateSchema = createSchema.partial();
const contributeSchema = z.object({ amount: z.coerce.number().max(99_999_999) });

const serialize = (g: { targetAmount: Prisma.Decimal; savedAmount: Prisma.Decimal } & Record<string, unknown>) => ({
  ...g,
  targetAmount: toNumber(g.targetAmount),
  savedAmount: toNumber(g.savedAmount),
  progress:
    Number(g.targetAmount) === 0
      ? 0
      : Math.min(1, Number(g.savedAmount) / Number(g.targetAmount)),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const goals = await prisma.savingsGoal.findMany({
      where: { userId: req.userId!, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json(goals.map(serialize));
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const g = await prisma.savingsGoal.create({
      data: {
        ...req.body,
        userId: req.userId!,
        targetAmount: toDecimal(req.body.targetAmount),
        savedAmount: toDecimal(req.body.savedAmount ?? 0),
      },
    });
    res.status(201).json(serialize(g));
  }),
);

router.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.savingsGoal.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const g = await prisma.savingsGoal.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        targetAmount:
          req.body.targetAmount !== undefined ? toDecimal(req.body.targetAmount) : undefined,
        savedAmount:
          req.body.savedAmount !== undefined ? toDecimal(req.body.savedAmount) : undefined,
      },
    });
    res.json(serialize(g));
  }),
);

router.post(
  '/:id/contribute',
  validate(contributeSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.savingsGoal.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const next = existing.savedAmount.add(toDecimal(req.body.amount));
    const g = await prisma.savingsGoal.update({
      where: { id: req.params.id },
      data: { savedAmount: next.lt(0) ? new Prisma.Decimal(0) : next },
    });
    res.json(serialize(g));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.savingsGoal.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    await prisma.savingsGoal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
