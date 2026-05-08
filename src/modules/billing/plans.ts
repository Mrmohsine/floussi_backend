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
    expensesPerMonth: 20,
    aiMessagesPerMonth: 3,
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
    aiMessagesPerMonth: 15,
    savingsGoals: 5,
    debts: 3,
    recurringBills: 10,
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
    historyMonths: 60,
    conversationHistory: true,
    csvExport: true,
    weeklyAiSummary: true,
  },
};

export const PLAN_PRICES: Record<Plan, number> = {
  FREE: 0,
  PRO: 6.99,
  PREMIUM: 12.99,
};

// Yearly billing uses fixed flat pricing: $5/mo on Pro, $10/mo on Premium —
// billed annually as $60 / $120. Premium yearly works out cheaper per-month
// than Pro monthly, which is the main upsell for the annual cycle.
export const PLAN_PRICES_YEARLY: Record<Plan, number> = {
  FREE: 0,
  PRO: 60,
  PREMIUM: 120,
};

export const isPlan = (s: string): s is Plan =>
  s === 'FREE' || s === 'PRO' || s === 'PREMIUM';

export function planOf(value: string): Plan {
  return isPlan(value) ? value : 'FREE';
}
