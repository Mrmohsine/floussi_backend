import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/errors';
import { PLAN_LIMITS, planOf, type Plan } from './plans';

export class PlanLimitError extends HttpError {
  constructor(message: string, public meta: { plan: Plan; feature: string; limit: number | null; current?: number }) {
    super(402, message, { code: 'plan_limit', ...meta });
  }
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  return planOf(u?.plan ?? 'FREE');
}

export function startOfMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function nextMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

// Throws if (year, month) is older than the plan's history window
// (relative to the current UTC month).
export function assertWithinHistoryWindow(plan: Plan, year: number, month: number) {
  const limits = PLAN_LIMITS[plan];
  const now = new Date();
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const requested = year * 12 + (month - 1);
  // Allow current month and next month always (planning ahead is harmless).
  if (requested > current) return;
  const monthsBack = current - requested;
  if (monthsBack >= limits.historyMonths) {
    throw new PlanLimitError(
      `Your plan only includes ${limits.historyMonths} month${limits.historyMonths === 1 ? '' : 's'} of history.`,
      { plan, feature: 'historyMonths', limit: limits.historyMonths },
    );
  }
}

export async function assertCanCreateExpense(userId: string) {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].expensesPerMonth;
  if (limit === null) return;
  const start = startOfMonth();
  const end = nextMonth();
  const count = await prisma.expense.count({
    where: { userId, date: { gte: start, lt: end } },
  });
  if (count >= limit) {
    throw new PlanLimitError(
      `Free plan is limited to ${limit} expenses per month. Upgrade to add more.`,
      { plan, feature: 'expensesPerMonth', limit, current: count },
    );
  }
}

export async function assertCanCreateSavingsGoal(userId: string) {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].savingsGoals;
  if (limit === null) return;
  const count = await prisma.savingsGoal.count({
    where: { userId, archivedAt: null },
  });
  if (count >= limit) {
    throw new PlanLimitError(
      `Your plan is limited to ${limit} savings goal${limit === 1 ? '' : 's'}.`,
      { plan, feature: 'savingsGoals', limit, current: count },
    );
  }
}

export async function assertCanCreateDebt(userId: string) {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].debts;
  if (limit === null) return;
  if (limit === 0) {
    throw new PlanLimitError(
      'Tracking debts requires Pro or Premium.',
      { plan, feature: 'debts', limit: 0 },
    );
  }
  const count = await prisma.debt.count({ where: { userId } });
  if (count >= limit) {
    throw new PlanLimitError(
      `Your plan is limited to ${limit} debt${limit === 1 ? '' : 's'}.`,
      { plan, feature: 'debts', limit, current: count },
    );
  }
}

export async function assertCanCreateRecurring(userId: string) {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].recurringBills;
  if (limit === null) return;
  if (limit === 0) {
    throw new PlanLimitError(
      'Recurring bills require Pro or Premium.',
      { plan, feature: 'recurringBills', limit: 0 },
    );
  }
  const count = await prisma.recurringBill.count({ where: { userId } });
  if (count >= limit) {
    throw new PlanLimitError(
      `Your plan is limited to ${limit} recurring bill${limit === 1 ? '' : 's'}.`,
      { plan, feature: 'recurringBills', limit, current: count },
    );
  }
}

export async function getAiMessageUsage(userId: string): Promise<number> {
  const start = startOfMonth();
  return prisma.chatMessage.count({
    where: {
      role: 'user',
      createdAt: { gte: start },
      conversation: { userId },
    },
  });
}

export async function assertCanSendAiMessage(userId: string) {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].aiMessagesPerMonth;
  if (limit === null) return;
  const used = await getAiMessageUsage(userId);
  if (used >= limit) {
    throw new PlanLimitError(
      `You've used all ${limit} AI message${limit === 1 ? '' : 's'} this month on your plan.`,
      { plan, feature: 'aiMessagesPerMonth', limit, current: used },
    );
  }
}
