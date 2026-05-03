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
  amount: money,
  source: z.string().min(1).max(60),
  receivedAt: z.coerce.date().optional(),
  note: z.string().max(280).optional().nullable(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const updateSchema = createSchema.partial();

const listQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const serialize = (i: { amount: Prisma.Decimal } & Record<string, unknown>) => ({
  ...i,
  amount: toNumber(i.amount),
});

async function ensureBudgetMonth(userId: string, year: number, month: number) {
  const existing = await prisma.budgetMonth.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  if (existing) return existing;
  return prisma.budgetMonth.create({
    data: {
      userId,
      year,
      month,
      plannedIncome: new Prisma.Decimal(0),
      savingsTarget: new Prisma.Decimal(0),
    },
  });
}

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { year, month } = req.query as unknown as z.infer<typeof listQuery>;
    const where: Prisma.IncomeWhereInput = { userId: req.userId! };
    if (year && month) {
      const budget = await prisma.budgetMonth.findUnique({
        where: { userId_year_month: { userId: req.userId!, year, month } },
      });
      if (!budget) {
        res.json([]);
        return;
      }
      where.budgetMonthId = budget.id;
    }
    const incomes = await prisma.income.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
    });
    res.json(incomes.map(serialize));
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { amount, source, note, receivedAt } = req.body as z.infer<typeof createSchema>;
    const now = new Date();
    const date = receivedAt ?? now;
    const y = req.body.year ?? date.getUTCFullYear();
    const m = req.body.month ?? date.getUTCMonth() + 1;
    const budget = await ensureBudgetMonth(req.userId!, y, m);

    const income = await prisma.income.create({
      data: {
        userId: req.userId!,
        budgetMonthId: budget.id,
        amount: toDecimal(amount),
        source,
        receivedAt: date,
        note: note ?? null,
      },
    });

    // Refresh plannedIncome on the budget month to reflect the new total.
    const all = await prisma.income.findMany({ where: { budgetMonthId: budget.id } });
    const total = all.reduce((acc, i) => acc.add(i.amount), new Prisma.Decimal(0));
    await prisma.budgetMonth.update({
      where: { id: budget.id },
      data: { plannedIncome: total },
    });

    res.status(201).json(serialize(income));
  }),
);

router.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.income.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const data: Prisma.IncomeUpdateInput = {};
    if (req.body.amount !== undefined) data.amount = toDecimal(req.body.amount);
    if (req.body.source !== undefined) data.source = req.body.source;
    if (req.body.note !== undefined) data.note = req.body.note ?? null;
    if (req.body.receivedAt !== undefined) data.receivedAt = req.body.receivedAt;
    const updated = await prisma.income.update({ where: { id: req.params.id }, data });

    if (existing.budgetMonthId) {
      const all = await prisma.income.findMany({ where: { budgetMonthId: existing.budgetMonthId } });
      const total = all.reduce((acc, i) => acc.add(i.amount), new Prisma.Decimal(0));
      await prisma.budgetMonth.update({
        where: { id: existing.budgetMonthId },
        data: { plannedIncome: total },
      });
    }

    res.json(serialize(updated));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.income.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    await prisma.income.delete({ where: { id: req.params.id } });

    if (existing.budgetMonthId) {
      const all = await prisma.income.findMany({ where: { budgetMonthId: existing.budgetMonthId } });
      const total = all.reduce((acc, i) => acc.add(i.amount), new Prisma.Decimal(0));
      await prisma.budgetMonth.update({
        where: { id: existing.budgetMonthId },
        data: { plannedIncome: total },
      });
    }

    res.status(204).end();
  }),
);

export default router;
