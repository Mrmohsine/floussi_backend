import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toDecimal, toNumber } from '../../utils/money';
import { notFound, badRequest } from '../../utils/errors';
import type {
  CreateExpenseInput,
  UpdateExpenseInput,
} from './expenses.schema';

const serialize = <T extends { amount: Prisma.Decimal }>(e: T) => ({
  ...e,
  amount: toNumber(e.amount),
});

async function findOrCreateBudget(userId: string, date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return prisma.budgetMonth.upsert({
    where: { userId_year_month: { userId, year, month } },
    create: { userId, year, month, plannedIncome: 0, savingsTarget: 0 },
    update: {},
  });
}

async function assertUserCanUseCategory(userId: string, categoryId: string) {
  const cat = await prisma.category.findFirst({
    where: {
      id: categoryId,
      OR: [
        { isSystem: true },
        { userCategories: { some: { userId } } },
      ],
    },
  });
  if (!cat) throw badRequest('Invalid category');
}

export async function createExpense(userId: string, input: CreateExpenseInput) {
  await assertUserCanUseCategory(userId, input.categoryId);

  const budget = await findOrCreateBudget(userId, input.date);
  const expense = await prisma.expense.create({
    data: {
      userId,
      categoryId: input.categoryId,
      budgetMonthId: budget.id,
      amount: toDecimal(input.amount),
      date: input.date,
      note: input.note ?? null,
      paymentMethod: input.paymentMethod,
      type: input.type,
    },
    include: { category: true },
  });
  return serialize(expense);
}

export async function updateExpense(
  userId: string,
  id: string,
  input: UpdateExpenseInput,
) {
  const existing = await prisma.expense.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();

  if (input.categoryId) {
    await assertUserCanUseCategory(userId, input.categoryId);
  }

  let budgetMonthId = existing.budgetMonthId;
  if (input.date) {
    const b = await findOrCreateBudget(userId, input.date);
    budgetMonthId = b.id;
  }

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      amount: input.amount !== undefined ? toDecimal(input.amount) : undefined,
      categoryId: input.categoryId,
      date: input.date,
      note: input.note,
      paymentMethod: input.paymentMethod,
      type: input.type,
      budgetMonthId,
    },
    include: { category: true },
  });
  return serialize(updated);
}

export async function deleteExpense(userId: string, id: string) {
  const existing = await prisma.expense.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();
  await prisma.expense.delete({ where: { id } });
}

export interface ListParams {
  page: number;
  pageSize: number;
  categoryId?: string;
  type?: 'FIXED_BILL' | 'VARIABLE';
  from?: Date;
  to?: Date;
  search?: string;
}

export async function listExpenses(userId: string, p: ListParams) {
  const where: Prisma.ExpenseWhereInput = {
    userId,
    categoryId: p.categoryId,
    type: p.type,
    date: p.from || p.to ? { gte: p.from, lte: p.to } : undefined,
    // SQLite ignores `mode`; Postgres uses it for ILIKE. Both work this way.
    note: p.search ? { contains: p.search } : undefined,
  };

  const [total, items] = await prisma.$transaction([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: { category: true },
      orderBy: { date: 'desc' },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    }),
  ]);

  return {
    items: items.map(serialize),
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount: Math.ceil(total / p.pageSize),
  };
}
