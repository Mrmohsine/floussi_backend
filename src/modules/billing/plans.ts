// Single source of truth for what each plan can do.
// Values are integers — `null` means "unlimited".

export type Plan = 'FREE' | 'PRO' | 'PREMIUM';

export interface PlanLimits {
  expensesPerMonth: number | null;
  aiMessagesPerMonth: number | null;
  savingsGoals: number | null;
  debts: number | null;
  recurringBills: number | null;
  historyMonths: number;
  conversationHistory: boolean;
  csvExport: boolean;
  weeklyAiSummary: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    expensesPerMonth: 3,
    aiMessagesPerMonth: 1,
    savingsGoals: 1,
    debts: 0,
    recurringBills: 0,
    historyMonths: 1,
    conversationHistory: false,
    csvExport: false,
    weeklyAiSummary: false,
  },
  PRO: {
    expensesPerMonth: null,
    aiMessagesPerMonth: 30,
    savingsGoals: 3,
    debts: 1,
    recurringBills: 3,
    historyMonths: 3,
    conversationHistory: false,
    csvExport: false,
    weeklyAiSummary: false,
  },
  PREMIUM: {
    expensesPerMonth: null,
    aiMessagesPerMonth: null,
    savingsGoals: null,
    debts: null,
    recurringBills: null,
    historyMonths: 12,
    conversationHistory: true,
    csvExport: true,
    weeklyAiSummary: true,
  },
};

export const PLAN_PRICES: Record<Plan, number> = {
  FREE: 0,
  PRO: 5,
  PREMIUM: 10,
};

export const isPlan = (s: string): s is Plan =>
  s === 'FREE' || s === 'PRO' || s === 'PREMIUM';

export function planOf(value: string): Plan {
  return isPlan(value) ? value : 'FREE';
}
