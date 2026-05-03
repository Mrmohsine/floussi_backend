import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { HttpError } from '../../utils/errors';
import { toNumber } from '../../utils/money';

// Lazily instantiated so the server still boots without an API key —
// the route handler returns a friendly error if the key is missing.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new HttpError(
      503,
      'AI chat is unavailable — backend is missing OPENAI_API_KEY.',
    );
  }
  if (!_client) _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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

async function buildContext(userId: string): Promise<string> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const [user, budget, goals, debts, recurring] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, currency: true, paySchedule: true },
    }),
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
    prisma.debt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.recurringBill.findMany({
      where: { userId, active: true },
      include: { category: true },
      orderBy: { dueDay: 'asc' },
    }),
  ]);

  if (!user) throw new HttpError(404, 'User not found');

  const fmt = moneyFormatter(user.currency);
  const m = (n: number) => fmt.format(n);

  const lines: string[] = [];
  lines.push(`USER PROFILE`);
  lines.push(`Name: ${user.name}`);
  lines.push(`Currency: ${user.currency}`);
  lines.push(`Pay schedule: ${user.paySchedule}`);
  lines.push('');

  lines.push(`CURRENT MONTH (${MONTHS[month - 1]} ${year})`);
  if (budget) {
    const totalSpent = budget.expenses.reduce(
      (acc: Prisma.Decimal, e) => acc.add(e.amount),
      new Prisma.Decimal(0),
    );
    const fixedSpent = budget.expenses
      .filter((e) => e.type === 'FIXED_BILL')
      .reduce((a, e) => a.add(e.amount), new Prisma.Decimal(0));
    const actualIncome = budget.incomes.reduce(
      (a, i) => a.add(i.amount),
      new Prisma.Decimal(0),
    );
    const incomeForRemaining = actualIncome.gt(0)
      ? actualIncome
      : budget.plannedIncome;
    const remaining = incomeForRemaining.sub(totalSpent);

    lines.push(`Planned income: ${m(toNumber(budget.plannedIncome))}`);
    lines.push(`Actual income so far: ${m(toNumber(actualIncome))}`);
    lines.push(`Total spent: ${m(toNumber(totalSpent))}`);
    lines.push(`Fixed bills (paid or scheduled): ${m(toNumber(fixedSpent))}`);
    lines.push(`Variable spending: ${m(toNumber(totalSpent.sub(fixedSpent)))}`);
    lines.push(`Remaining: ${m(toNumber(remaining))}`);
    lines.push(`Savings target: ${m(toNumber(budget.savingsTarget))}`);

    const cats = new Map<string, { name: string; total: Prisma.Decimal }>();
    for (const e of budget.expenses) {
      const cur = cats.get(e.category.name) ?? {
        name: e.category.name,
        total: new Prisma.Decimal(0),
      };
      cur.total = cur.total.add(e.amount);
      cats.set(e.category.name, cur);
    }
    const topCats = [...cats.values()]
      .sort((a, b) => Number(b.total) - Number(a.total))
      .slice(0, 8);

    if (topCats.length) {
      lines.push('');
      lines.push('TOP SPENDING THIS MONTH');
      for (const c of topCats) {
        lines.push(`- ${c.name}: ${m(toNumber(c.total))}`);
      }
    }
  } else {
    lines.push(`(No budget set up for this month yet.)`);
  }

  if (recurring.length) {
    lines.push('');
    lines.push('RECURRING BILLS');
    for (const b of recurring) {
      lines.push(
        `- ${b.name} (${b.category.name}): ${m(toNumber(b.amount))} on day ${b.dueDay}`,
      );
    }
  }

  if (goals.length) {
    lines.push('');
    lines.push('SAVINGS GOALS');
    for (const g of goals) {
      const saved = toNumber(g.savedAmount);
      const target = toNumber(g.targetAmount);
      const pct = target > 0 ? Math.round((saved / target) * 100) : 0;
      lines.push(`- ${g.name}: ${m(saved)} of ${m(target)} (${pct}%)`);
    }
  }

  if (debts.length) {
    lines.push('');
    lines.push('DEBTS');
    for (const d of debts) {
      lines.push(
        `- ${d.name} (${d.type}): ${m(toNumber(d.remainingAmount))} remaining at ${Number(
          d.interestRate,
        ).toFixed(2)}% APR, min payment ${m(toNumber(d.minimumPayment))}`,
      );
    }
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT_HEADER = `You are Paycheck's AI money coach. The user is a personal-finance app user asking about their budget. You have access to their actual current financial data below — use it.

How to behave:
- Concise. This is a mobile chat — 1-3 short paragraphs maximum unless they explicitly ask for detail.
- Practical. Actionable suggestions over abstract advice.
- Encouraging but honest. If they're overspending or off-track, say so kindly with specifics.
- Reference their real numbers when relevant. Use the user's currency symbol from their profile. Show whole numbers (no cents).
- If they ask something you can't answer from the data (e.g. "what's the stock market doing?"), say so briefly and steer back to their finances.
- No financial-advisor disclaimers, no "consult a professional" boilerplate, no markdown headings. Plain text replies.

Their current state:`;

export async function chat(
  userId: string,
  messages: ChatMessage[],
): Promise<{ content: string }> {
  const client = getClient();
  const context = await buildContext(userId);

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT_HEADER}\n\n${context}` },
      ...messages.map((m) => ({ role: m.role, content: m.content }) as const),
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '';
  return {
    content:
      text ||
      "I'm not sure how to answer that — try asking about your budget, spending, or goals.",
  };
}
