import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toNumber } from '../../utils/money';

export type InsightLevel = 'positive' | 'info' | 'warning' | 'alert';

export interface Insight {
  id: string;             // stable rule key, e.g. "dining_share_high"
  level: InsightLevel;
  title: string;
  body: string;
  data?: Record<string, number | string>;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// Build a currency formatter for the active user. Whole units only —
// no one says "I overspent by $123.45 on dining out".
function moneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      currencyDisplay: 'narrowSymbol',
    });
  } catch {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }
}

const NAME_RULES: Record<string, RegExp> = {
  diningOut: /dining|restaurant/i,
  coffee: /coffee/i,
  subscriptions: /subscription/i,
  creditCard: /credit card payment/i,
};

export async function generateInsights(
  userId: string,
  year: number,
  month: number,
): Promise<Insight[]> {
  const insights: Insight[] = [];

  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  });
  const fmt = moneyFormatter(userRow?.currency ?? 'USD');
  const usd = (n: number) => fmt.format(n);

  const budget = await prisma.budgetMonth.findUnique({
    where: { userId_year_month: { userId, year, month } },
    include: {
      expenses: { include: { category: true } },
      incomes: true,
    },
  });

  const goals = await prisma.savingsGoal.findMany({
    where: { userId, archivedAt: null },
  });
  for (const g of goals) {
    if (g.savedAmount.gte(g.targetAmount) && g.targetAmount.gt(0)) {
      insights.push({
        id: `goal_reached_${g.id}`,
        level: 'positive',
        title: `${g.name} — goal reached!`,
        body: `Nice work — you saved ${usd(toNumber(g.savedAmount))}.`,
      });
    }
  }

  if (!budget) return insights;

  const income = budget.incomes.length
    ? budget.incomes.reduce((a, i) => a.add(i.amount), new Prisma.Decimal(0))
    : budget.plannedIncome;
  const incomeN = toNumber(income);
  if (incomeN <= 0) return insights;

  const totalSpent = budget.expenses.reduce(
    (a, e) => a.add(e.amount),
    new Prisma.Decimal(0),
  );
  const totalSpentN = toNumber(totalSpent);

  // Spending exceeds income
  if (totalSpentN > incomeN) {
    insights.push({
      id: 'over_budget',
      level: 'alert',
      title: 'Spending is above income',
      body: `You've spent ${usd(totalSpentN)} this month against ${usd(incomeN)} income.`,
      data: { spent: totalSpentN, income: incomeN },
    });
  }

  // Remaining < 10%
  const remaining = incomeN - totalSpentN;
  if (remaining > 0 && remaining < 0.1 * incomeN) {
    insights.push({
      id: 'remaining_low',
      level: 'warning',
      title: 'Running low on this paycheck',
      body: `Only ${usd(remaining)} left — that's under 10% of your income.`,
      data: { remaining, income: incomeN },
    });
  }

  // Per-category aggregates
  const cats = new Map<string, { name: string; total: number }>();
  for (const e of budget.expenses) {
    const cur = cats.get(e.category.name) ?? { name: e.category.name, total: 0 };
    cur.total += toNumber(e.amount);
    cats.set(e.category.name, cur);
  }

  // Dining out > 15% of income
  const dining = [...cats.values()].find((c) => NAME_RULES.diningOut.test(c.name));
  if (dining) {
    const share = dining.total / incomeN;
    if (share > 0.15) {
      insights.push({
        id: 'dining_share_high',
        level: 'warning',
        title: 'Dining out is eating your paycheck',
        body: `You spent ${pct(share)} of your income (${usd(dining.total)}) on dining out.`,
        data: { share, amount: dining.total },
      });
    }
  }

  // Subscriptions > $100
  const subs = [...cats.values()].find((c) => NAME_RULES.subscriptions.test(c.name));
  if (subs && subs.total > 100) {
    insights.push({
      id: 'subscriptions_high',
      level: 'warning',
      title: 'Subscriptions adding up',
      body: `${usd(subs.total)} on subscriptions this month — worth a quick audit.`,
      data: { amount: subs.total },
    });
  }

  // Credit card payments high vs income (>20%)
  const cc = [...cats.values()].find((c) => NAME_RULES.creditCard.test(c.name));
  if (cc && cc.total / incomeN > 0.2) {
    insights.push({
      id: 'credit_card_heavy',
      level: 'warning',
      title: 'Credit card payments are heavy',
      body: `${pct(cc.total / incomeN)} of income (${usd(cc.total)}) went to credit card payments.`,
    });
  }

  // Week-over-week trend
  const now = new Date();
  const isCurrent = now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  if (isCurrent) {
    const day = now.getUTCDate();
    if (day >= 8) {
      const sumBetween = (start: number, end: number) =>
        budget.expenses
          .filter((e) => {
            const d = e.date.getUTCDate();
            return d >= start && d <= end;
          })
          .reduce((a, e) => a + toNumber(e.amount), 0);

      const lastWeekStart = Math.max(1, day - 13);
      const lastWeekEnd = day - 7;
      const thisWeekStart = day - 6;
      const lastWeek = sumBetween(lastWeekStart, lastWeekEnd);
      const thisWeek = sumBetween(thisWeekStart, day);
      if (lastWeek > 0 && thisWeek > lastWeek * 1.25) {
        insights.push({
          id: 'week_over_week_up',
          level: 'alert',
          title: 'Spending is up this week',
          body: `${usd(thisWeek)} this week vs ${usd(lastWeek)} last week.`,
          data: { thisWeek, lastWeek },
        });
      }
    }
  }

  // Top category nudge
  const top = [...cats.values()].sort((a, b) => b.total - a.total)[0];
  if (top && top.total / incomeN > 0.05) {
    insights.push({
      id: 'top_category',
      level: 'info',
      title: 'Top category this month',
      body: `${top.name} — ${pct(top.total / incomeN)} of your income (${usd(top.total)}).`,
    });
  }

  return insights;
}
