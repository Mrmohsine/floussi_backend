import { prisma } from '../../config/prisma';
import { Prisma } from '@prisma/client';
import { toDecimal, toNumber } from '../../utils/money';
import { notFound } from '../../utils/errors';
import type { UpsertBudgetInput } from './budgets.schema';

export async function upsertBudget(userId: string, input: UpsertBudgetInput) {
  // If recurring bills exist and the budget is brand-new, materialize them
  // as fixed-bill expenses so the user starts with their bills already loaded.
  return prisma.$transaction(async (tx) => {
    const existing = await tx.budgetMonth.findUnique({
      where: { userId_year_month: { userId, year: input.year, month: input.month } },
    });

    const budget = await tx.budgetMonth.upsert({
      where: { userId_year_month: { userId, year: input.year, month: input.month } },
      create: {
        userId,
        year: input.year,
        month: input.month,
        plannedIncome: toDecimal(input.plannedIncome),
        savingsTarget: toDecimal(input.savingsTarget),
        notes: input.notes ?? null,
      },
      update: {
        plannedIncome: toDecimal(input.plannedIncome),
        savingsTarget: toDecimal(input.savingsTarget),
        notes: input.notes ?? null,
      },
    });

    if (!existing) {
      const bills = await tx.recurringBill.findMany({
        where: { userId, active: true, frequency: 'MONTHLY' },
      });
      if (bills.length) {
        await tx.expense.createMany({
          data: bills.map((b) => ({
            userId,
            categoryId: b.categoryId,
            budgetMonthId: budget.id,
            amount: b.amount,
            date: new Date(input.year, input.month - 1, Math.min(b.dueDay, 28)),
            note: `${b.name} (auto)`,
            paymentMethod: b.paymentMethod,
            type: 'FIXED_BILL' as const,
            recurringBillId: b.id,
          })),
        });
      }
    }

    return budget;
  });
}

export async function getBudgetSummary(userId: string, year: number, month: number) {
  const budget = await prisma.budgetMonth.findUnique({
    where: { userId_year_month: { userId, year, month } },
    include: {
      expenses: { include: { category: true } },
      incomes: true,
    },
  });

  if (!budget) {
    return {
      exists: false as const,
      year,
      month,
      plannedIncome: 0,
      actualIncome: 0,
      savingsTarget: 0,
      totalSpent: 0,
      fixedSpent: 0,
      variableSpent: 0,
      remaining: 0,
      incomes: [] as Array<{ id: string; source: string; amount: number; receivedAt: string; note: string | null }>,
      byCategory: [] as Array<{ categoryId: string; name: string; icon: string; color: string; total: number }>,
      byWeek: [] as Array<{ week: number; total: number }>,
      upcomingBills: [] as Array<{ id: string; name: string; amount: number; dueDay: number }>,
    };
  }

  const totalSpent = budget.expenses.reduce(
    (acc: Prisma.Decimal, e) => acc.add(e.amount),
    new Prisma.Decimal(0),
  );
  const fixedSpent = budget.expenses
    .filter((e) => e.type === 'FIXED_BILL')
    .reduce((acc, e) => acc.add(e.amount), new Prisma.Decimal(0));
  const variableSpent = totalSpent.sub(fixedSpent);

  const actualIncome = budget.incomes.reduce(
    (acc, i) => acc.add(i.amount),
    new Prisma.Decimal(0),
  );

  const incomeForRemaining = actualIncome.gt(0) ? actualIncome : budget.plannedIncome;
  const remaining = incomeForRemaining.sub(totalSpent);

  // By category
  const catMap = new Map<
    string,
    { categoryId: string; name: string; icon: string; color: string; total: Prisma.Decimal }
  >();
  for (const e of budget.expenses) {
    const cur = catMap.get(e.categoryId) ?? {
      categoryId: e.categoryId,
      name: e.category.name,
      icon: e.category.icon,
      color: e.category.color,
      total: new Prisma.Decimal(0),
    };
    cur.total = cur.total.add(e.amount);
    catMap.set(e.categoryId, cur);
  }
  const byCategory = Array.from(catMap.values())
    .map((c) => ({ ...c, total: toNumber(c.total) }))
    .sort((a, b) => b.total - a.total);

  // By ISO-ish week of the month
  const weekMap = new Map<number, Prisma.Decimal>();
  for (const e of budget.expenses) {
    const day = e.date.getUTCDate();
    const w = Math.min(5, Math.ceil(day / 7));
    weekMap.set(w, (weekMap.get(w) ?? new Prisma.Decimal(0)).add(e.amount));
  }
  const byWeek = Array.from({ length: 5 }, (_, i) => ({
    week: i + 1,
    total: toNumber(weekMap.get(i + 1) ?? new Prisma.Decimal(0)),
  }));

  // Upcoming bills (recurring ones tied to this budget that are still in the future)
  const today = new Date();
  const upcomingBills = budget.expenses
    .filter((e) => e.type === 'FIXED_BILL' && e.date > today)
    .map((e) => ({
      id: e.id,
      name: e.note ?? e.category.name,
      amount: toNumber(e.amount),
      dueDay: e.date.getUTCDate(),
    }))
    .sort((a, b) => a.dueDay - b.dueDay)
    .slice(0, 5);

  const incomes = budget.incomes
    .slice()
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    .map((i) => ({
      id: i.id,
      source: i.source,
      amount: toNumber(i.amount),
      receivedAt: i.receivedAt.toISOString(),
      note: i.note,
    }));

  return {
    exists: true as const,
    id: budget.id,
    year,
    month,
    plannedIncome: toNumber(budget.plannedIncome),
    actualIncome: toNumber(actualIncome),
    savingsTarget: toNumber(budget.savingsTarget),
    totalSpent: toNumber(totalSpent),
    fixedSpent: toNumber(fixedSpent),
    variableSpent: toNumber(variableSpent),
    remaining: toNumber(remaining),
    incomes,
    byCategory,
    byWeek,
    upcomingBills,
  };
}

export async function deleteBudget(userId: string, id: string) {
  const b = await prisma.budgetMonth.findFirst({ where: { id, userId } });
  if (!b) throw notFound();
  await prisma.budgetMonth.delete({ where: { id } });
}
