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
      'CREDIT_CARD',
      'STUDENT_LOAN',
      'AUTO_LOAN',
      'PERSONAL_LOAN',
      'MORTGAGE',
      'MEDICAL',
      'OTHER',
    ])
    .default('OTHER'),
  totalAmount: money,
  remainingAmount: money,
  interestRate: z.coerce.number().min(0).max(100).default(0),
  minimumPayment: money,
  dueDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  payoffDate: z.coerce.date().optional().nullable(),
});

const updateSchema = createSchema.partial();
const paySchema = z.object({ amount: z.coerce.number().positive() });

const serialize = (d: any) => ({
  ...d,
  totalAmount: toNumber(d.totalAmount),
  remainingAmount: toNumber(d.remainingAmount),
  interestRate: Number(d.interestRate),
  minimumPayment: toNumber(d.minimumPayment),
  progress:
    Number(d.totalAmount) === 0
      ? 0
      : 1 - Number(d.remainingAmount) / Number(d.totalAmount),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const debts = await prisma.debt.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json(debts.map(serialize));
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const d = await prisma.debt.create({
      data: {
        ...req.body,
        userId: req.userId!,
        totalAmount: toDecimal(req.body.totalAmount),
        remainingAmount: toDecimal(req.body.remainingAmount),
        minimumPayment: toDecimal(req.body.minimumPayment),
        interestRate: new Prisma.Decimal(req.body.interestRate),
      },
    });
    res.status(201).json(serialize(d));
  }),
);

router.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.debt.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const d = await prisma.debt.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        totalAmount:
          req.body.totalAmount !== undefined ? toDecimal(req.body.totalAmount) : undefined,
        remainingAmount:
          req.body.remainingAmount !== undefined ? toDecimal(req.body.remainingAmount) : undefined,
        minimumPayment:
          req.body.minimumPayment !== undefined ? toDecimal(req.body.minimumPayment) : undefined,
        interestRate:
          req.body.interestRate !== undefined
            ? new Prisma.Decimal(req.body.interestRate)
            : undefined,
      },
    });
    res.json(serialize(d));
  }),
);

router.post(
  '/:id/pay',
  validate(paySchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.debt.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const next = existing.remainingAmount.sub(toDecimal(req.body.amount));
    const d = await prisma.debt.update({
      where: { id: req.params.id },
      data: { remainingAmount: next.lt(0) ? new Prisma.Decimal(0) : next },
    });
    res.json(serialize(d));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.debt.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    await prisma.debt.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
