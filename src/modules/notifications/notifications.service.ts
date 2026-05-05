import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { toNumber } from '../../utils/money';

export type SmartNotificationTone = 'warning' | 'positive' | 'info' | 'alert';

export interface SmartNotification {
  id: string;
  tone: SmartNotificationTone;
  title: string;
  body: string;
  actionLabel?: string;
  priority: number;
  createdAt: string;
  readAt: string | null;
}

type GeneratedSmartNotification = Omit<SmartNotification, 'createdAt' | 'readAt'>;
type CandidateSmartNotification = GeneratedSmartNotification & { fingerprint: string };

const MAX_SMART_NOTIFICATIONS_PER_MONTH = 8;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

const CATEGORY_RULES: Array<{
  id: string;
  pattern: RegExp;
  warningTitle: string;
  shareLimit: number;
}> = [
  {
    id: 'tobacco_high',
    pattern: /cigarette|cigarettes|tobacco|smoke|smoking|vape|vaping/i,
    warningTitle: 'Tobacco spending is getting high',
    shareLimit: 0.04,
  },
  {
    id: 'dining_high',
    pattern: /dining|restaurant|takeout|fast food/i,
    warningTitle: 'Dining out is adding up',
    shareLimit: 0.15,
  },
  {
    id: 'shopping_high',
    pattern: /shopping|clothes|clothing/i,
    warningTitle: 'Shopping is running hot',
    shareLimit: 0.12,
  },
  {
    id: 'coffee_high',
    pattern: /coffee/i,
    warningTitle: 'Coffee runs are stacking up',
    shareLimit: 0.04,
  },
];

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

const monthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`;

let _client: OpenAI | null = null;
function getAiClient(): OpenAI | null {
  if (!env.OPENAI_API_KEY || env.NODE_ENV === 'test') return null;
  if (!_client) _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

function notificationFingerprint(n: GeneratedSmartNotification) {
  return createHash('sha256')
    .update(JSON.stringify({
      id: n.id,
      tone: n.tone,
      title: n.title,
      body: n.body,
      actionLabel: n.actionLabel ?? null,
      priority: n.priority,
    }))
    .digest('hex');
}

function withFingerprints(
  generated: GeneratedSmartNotification[],
): CandidateSmartNotification[] {
  return generated.map((n) => ({
    ...n,
    fingerprint: notificationFingerprint(n),
  }));
}

function serializeNotification(n: {
  id: string;
  tone: string;
  title: string;
  body: string;
  actionLabel: string | null;
  priority: number;
  createdAt: Date;
  readAt: Date | null;
}): SmartNotification {
  return {
    id: n.id,
    tone: n.tone as SmartNotificationTone,
    title: n.title,
    body: n.body,
    actionLabel: n.actionLabel ?? undefined,
    priority: n.priority,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}

async function generateSmartNotifications(
  userId: string,
  year: number,
  month: number,
): Promise<GeneratedSmartNotification[]> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true, name: true },
  });
  const fmt = moneyFormatter(user?.currency ?? 'USD');
  const money = (n: number) => fmt.format(n);

  const [budget, goals, debts] = await Promise.all([
    prisma.budgetMonth.findUnique({
      where: { userId_year_month: { userId, year, month } },
      include: {
        expenses: { include: { category: true } },
        incomes: true,
      },
    }),
    prisma.savingsGoal.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.debt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const out: GeneratedSmartNotification[] = [];
  const push = (n: GeneratedSmartNotification) => {
    out.push(n);
  };

  for (const goal of goals) {
    const saved = toNumber(goal.savedAmount);
    const target = toNumber(goal.targetAmount);
    if (target <= 0) continue;
    const progress = saved / target;
    const left = Math.max(0, target - saved);

    if (progress >= 1) {
      push({
        id: `goal_reached_${goal.id}`,
        tone: 'positive',
        title: `${goal.name} is fully funded`,
        body: `Nice work. You hit your ${money(target)} target.`,
        actionLabel: 'View goal',
        priority: 95,
      });
    } else if (progress >= 0.8) {
      push({
        id: `goal_close_${goal.id}`,
        tone: 'positive',
        title: `${goal.name} is close`,
        body: `You're ${money(left)} away from the finish line.`,
        actionLabel: 'Add savings',
        priority: 75,
      });
    } else if (progress < 0.25 && now.getUTCDate() >= 20) {
      push({
        id: `goal_needs_attention_${goal.id}`,
        tone: 'warning',
        title: `${goal.name} needs a push`,
        body: `You're at ${pct(progress)}. Try saving a little more before the month ends.`,
        actionLabel: 'View goal',
        priority: 62,
      });
    }
  }

  const activeDebts = debts.filter((d) => toNumber(d.remainingAmount) > 0);
  const totalDebt = activeDebts.reduce((sum, d) => sum + toNumber(d.remainingAmount), 0);
  const totalMinimums = activeDebts.reduce((sum, d) => sum + toNumber(d.minimumPayment), 0);
  const highestApr = [...activeDebts].sort(
    (a, b) => Number(b.interestRate) - Number(a.interestRate),
  )[0];

  if (activeDebts.length > 0) {
    push({
      id: 'debt_balance_active',
      tone: 'warning',
      title: 'Debt needs a payoff plan',
      body: `You have ${money(totalDebt)} across ${activeDebts.length} active debt${activeDebts.length === 1 ? '' : 's'}. Minimum payments total ${money(totalMinimums)}.`,
      actionLabel: 'View debts',
      priority: 88,
    });
  }

  if (highestApr && Number(highestApr.interestRate) >= 18) {
    push({
      id: `debt_high_apr_${highestApr.id}`,
      tone: 'alert',
      title: `${highestApr.name} has a high APR`,
      body: `${Number(highestApr.interestRate).toFixed(2)}% APR is expensive. Consider paying this one down first.`,
      actionLabel: 'View debt',
      priority: 94,
    });
  }

  const currentMonth =
    now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  if (currentMonth) {
    const today = now.getUTCDate();
    const upcomingDebt = activeDebts
      .filter((d) => d.dueDay !== null && d.dueDay >= today && d.dueDay <= today + 5)
      .sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99))[0];
    if (upcomingDebt) {
      push({
        id: `debt_due_soon_${upcomingDebt.id}`,
        tone: 'warning',
        title: `${upcomingDebt.name} payment is coming up`,
        body: `${money(toNumber(upcomingDebt.minimumPayment))} minimum payment is due on day ${upcomingDebt.dueDay}.`,
        actionLabel: 'View debts',
        priority: 90,
      });
    }
  }

  for (const debt of activeDebts) {
    const total = toNumber(debt.totalAmount);
    const remainingDebt = toNumber(debt.remainingAmount);
    if (total <= 0) continue;
    const paidRatio = 1 - remainingDebt / total;
    if (paidRatio >= 0.75) {
      push({
        id: `debt_progress_${debt.id}`,
        tone: 'positive',
        title: `${debt.name} is almost paid down`,
        body: `You've paid off ${pct(paidRatio)}. Only ${money(remainingDebt)} remains.`,
        actionLabel: 'View debt',
        priority: 70,
      });
    }
  }

  if (!budget) {
    push({
      id: 'budget_missing',
      tone: 'info',
      title: `${MONTHS[month - 1]} budget is not set up`,
      body: 'Add your income and savings target so I can warn you before spending gets risky.',
      actionLabel: 'Set budget',
      priority: 80,
    });
    return out
      .sort((a, b) => b.priority - a.priority)
      .slice(0, MAX_SMART_NOTIFICATIONS_PER_MONTH);
  }

  const income = budget.incomes.length
    ? budget.incomes.reduce((a, i) => a.add(i.amount), new Prisma.Decimal(0))
    : budget.plannedIncome;
  const incomeN = toNumber(income);
  const totalSpent = budget.expenses.reduce(
    (a, e) => a.add(e.amount),
    new Prisma.Decimal(0),
  );
  const spentN = toNumber(totalSpent);
  const remaining = incomeN - spentN;
  const savingsTarget = toNumber(budget.savingsTarget);

  if (incomeN > 0 && spentN > incomeN) {
    push({
      id: 'over_income',
      tone: 'alert',
      title: 'You spent more than your income',
      body: `You spent ${money(spentN)} against ${money(incomeN)} income this month.`,
      actionLabel: 'Review spending',
      priority: 100,
    });
  } else if (incomeN > 0 && remaining < savingsTarget && savingsTarget > 0) {
    push({
      id: 'saving_target_at_risk',
      tone: 'warning',
      title: 'Your saving target needs attention',
      body: `You have ${money(remaining)} left, but your target is ${money(savingsTarget)}.`,
      actionLabel: 'Adjust budget',
      priority: 86,
    });
  } else if (incomeN > 0 && savingsTarget > 0 && remaining >= savingsTarget) {
    push({
      id: 'saving_target_safe',
      tone: 'positive',
      title: 'Your saving target is still safe',
      body: `You're on track to keep ${money(savingsTarget)} aside this month.`,
      actionLabel: 'View budget',
      priority: 58,
    });
  }

  const byCategory = new Map<string, { name: string; amount: number }>();
  for (const expense of budget.expenses) {
    const current = byCategory.get(expense.categoryId) ?? {
      name: expense.category.name,
      amount: 0,
    };
    current.amount += toNumber(expense.amount);
    byCategory.set(expense.categoryId, current);
  }

  for (const rule of CATEGORY_RULES) {
    const match = [...byCategory.values()].find((c) => rule.pattern.test(c.name));
    if (!match || incomeN <= 0) continue;
    const share = match.amount / incomeN;
    if (share >= rule.shareLimit) {
      push({
        id: rule.id,
        tone: 'warning',
        title: rule.warningTitle,
        body: `${match.name} is at ${money(match.amount)} this month (${pct(share)} of income).`,
        actionLabel: 'See expenses',
        priority: Math.min(96, 64 + Math.round(share * 100)),
      });
    }
  }

  if (currentMonth && incomeN > 0 && now.getUTCDate() >= 24 && spentN <= incomeN * 0.75) {
    push({
      id: 'month_good_job',
      tone: 'positive',
      title: 'You did well this month',
      body: `You've used ${pct(spentN / incomeN)} of your income and still have ${money(remaining)} left.`,
      actionLabel: 'View dashboard',
      priority: 60,
    });
  }

  if (budget.expenses.length === 0) {
    push({
      id: 'no_expenses_yet',
      tone: 'info',
      title: 'No expenses tracked yet',
      body: 'Add expenses as they happen and I will start spotting patterns for you.',
      actionLabel: 'Add expense',
      priority: 45,
    });
  }

  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_SMART_NOTIFICATIONS_PER_MONTH);
}

type AiNotificationPayload = {
  id: string;
  tone?: SmartNotificationTone;
  title?: string;
  body?: string;
  actionLabel?: string | null;
  priority?: number;
};

function clampText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed;
}

function parseAiNotificationJson(content: string): AiNotificationPayload[] {
  const parsed = JSON.parse(content) as { items?: AiNotificationPayload[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

function mergeAiNotifications(
  candidates: CandidateSmartNotification[],
  aiItems: AiNotificationPayload[],
) {
  const byId = new Map(candidates.map((n) => [n.id, n]));
  const merged: CandidateSmartNotification[] = [];

  for (const item of aiItems) {
    const base = byId.get(item.id);
    if (!base) continue;
    byId.delete(item.id);
    const priority =
      typeof item.priority === 'number' && Number.isFinite(item.priority)
        ? Math.max(0, Math.min(100, Math.round(item.priority)))
        : base.priority;
    const tone =
      item.tone && ['positive', 'info', 'warning', 'alert'].includes(item.tone)
        ? item.tone
        : base.tone;

    merged.push({
      ...base,
      tone,
      title: clampText(item.title, 90) ?? base.title,
      body: clampText(item.body, 220) ?? base.body,
      actionLabel: clampText(item.actionLabel, 24) ?? base.actionLabel,
      priority,
    });
  }

  merged.push(...byId.values());
  return merged
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_SMART_NOTIFICATIONS_PER_MONTH);
}

async function enhanceNotificationsWithAi(
  candidates: CandidateSmartNotification[],
  cached: Array<{
    sourceId: string;
    fingerprint: string | null;
    aiEnhancedAt: Date | null;
  }>,
) {
  const fallback = candidates
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_SMART_NOTIFICATIONS_PER_MONTH);
  const cachedBySource = new Map(cached.map((n) => [n.sourceId, n]));
  const canReuseExistingAi = candidates.every((n) => {
    const existing = cachedBySource.get(n.id);
    return existing?.aiEnhancedAt && existing.fingerprint === n.fingerprint;
  });
  if (canReuseExistingAi) {
    return { notifications: fallback, enhanced: false, reuseExisting: true };
  }

  const client = getAiClient();
  if (!client || candidates.length === 0) {
    return { notifications: fallback, enhanced: false, reuseExisting: false };
  }

  try {
    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You rewrite and rank personal-finance notification candidates. Rules already detected the risks; do not invent new facts or new ids. Return strict JSON only: {"items":[{"id":"...","tone":"positive|info|warning|alert","title":"...","body":"...","actionLabel":"...","priority":0-100}]}. Keep titles under 70 chars, bodies under 180 chars, warm but direct, no markdown.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            maxItems: MAX_SMART_NOTIFICATIONS_PER_MONTH,
            candidates: candidates.map((n) => ({
              id: n.id,
              tone: n.tone,
              title: n.title,
              body: n.body,
              actionLabel: n.actionLabel ?? null,
              priority: n.priority,
            })),
          }),
        },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim() ?? '';
    if (!text) return { notifications: fallback, enhanced: false, reuseExisting: false };
    return {
      notifications: mergeAiNotifications(candidates, parseAiNotificationJson(text)),
      enhanced: true,
      reuseExisting: false,
    };
  } catch {
    return { notifications: fallback, enhanced: false, reuseExisting: false };
  }
}

export async function listSmartNotifications(
  userId: string,
  year: number,
  month: number,
): Promise<SmartNotification[]> {
  const key = monthKey(year, month);
  const generated = withFingerprints(await generateSmartNotifications(userId, year, month));
  const activeSourceIds = generated.map((n) => n.id);
  await prisma.notification.deleteMany({
    where: {
      userId,
      monthKey: key,
      ...(activeSourceIds.length > 0 ? { sourceId: { notIn: activeSourceIds } } : {}),
    },
  });
  const existing = await prisma.notification.findMany({
    where: { userId, monthKey: key },
    select: { sourceId: true, fingerprint: true, aiEnhancedAt: true },
  });
  const { notifications, enhanced, reuseExisting } = await enhanceNotificationsWithAi(
    generated,
    existing,
  );
  const enhancedAt = enhanced ? new Date() : undefined;

  if (!reuseExisting) {
    for (const n of notifications) {
      await prisma.notification.upsert({
        where: {
          userId_monthKey_sourceId: {
            userId,
            monthKey: key,
            sourceId: n.id,
          },
        },
        update: {
          tone: n.tone,
          title: n.title,
          body: n.body,
          actionLabel: n.actionLabel ?? null,
          priority: n.priority,
          fingerprint: n.fingerprint,
          aiEnhancedAt: enhancedAt ?? null,
        },
        create: {
          userId,
          monthKey: key,
          sourceId: n.id,
          tone: n.tone,
          title: n.title,
          body: n.body,
          actionLabel: n.actionLabel ?? null,
          priority: n.priority,
          fingerprint: n.fingerprint,
          aiEnhancedAt: enhancedAt ?? null,
        },
      });
    }
  }

  const saved = await prisma.notification.findMany({
    where: { userId, monthKey: key },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: MAX_SMART_NOTIFICATIONS_PER_MONTH,
  });

  return saved.map(serializeNotification);
}

export async function markNotificationRead(userId: string, id: string) {
  const existing = await prisma.notification.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: existing.readAt ?? new Date() },
  });
  return serializeNotification(updated);
}

export async function markMonthNotificationsRead(
  userId: string,
  year: number,
  month: number,
) {
  await prisma.notification.updateMany({
    where: {
      userId,
      monthKey: monthKey(year, month),
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}
