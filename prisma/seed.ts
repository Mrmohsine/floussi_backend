import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SYSTEM_CATEGORIES = [
  { name: 'Rent / Mortgage',     icon: 'home',         color: '#6366F1' },
  { name: 'Groceries',           icon: 'shopping-cart',color: '#10B981' },
  { name: 'Gas',                 icon: 'fuel',         color: '#F59E0B' },
  { name: 'Car Payment',         icon: 'car',          color: '#3B82F6' },
  { name: 'Car Insurance',       icon: 'shield',       color: '#0EA5E9' },
  { name: 'Health Insurance',    icon: 'heart',        color: '#EF4444' },
  { name: 'Utilities',           icon: 'zap',          color: '#FACC15' },
  { name: 'Phone',               icon: 'phone',        color: '#8B5CF6' },
  { name: 'Internet',            icon: 'wifi',         color: '#06B6D4' },
  { name: 'Credit Card Payment', icon: 'credit-card',  color: '#DC2626' },
  { name: 'Student Loans',       icon: 'graduation-cap', color: '#7C3AED' },
  { name: 'Childcare',           icon: 'baby',         color: '#EC4899' },
  { name: 'Subscriptions',       icon: 'play-circle',  color: '#F472B6' },
  { name: 'Dining Out',          icon: 'utensils',     color: '#F97316' },
  { name: 'Coffee',              icon: 'coffee',       color: '#A16207' },
  { name: 'Shopping',            icon: 'shopping-bag', color: '#D946EF' },
  { name: 'Medical',             icon: 'stethoscope',  color: '#E11D48' },
  { name: 'Entertainment',       icon: 'film',         color: '#22D3EE' },
  { name: 'Savings',             icon: 'piggy-bank',   color: '#10B981' },
  { name: 'Emergency Fund',      icon: 'shield-alert', color: '#059669' },
  { name: 'Other',               icon: 'tag',          color: '#6B7280' },
];

async function seedSystemCategories() {
  // userId is nullable so the (userId, name) unique can't match here — do an
  // idempotent insert via findFirst → create.
  for (const c of SYSTEM_CATEGORIES) {
    const exists = await prisma.category.findFirst({
      where: { isSystem: true, name: c.name },
    });
    if (!exists) {
      await prisma.category.create({
        data: { ...c, isSystem: true, userId: null },
      });
    }
  }
}

async function seedDemoUser() {
  const email = 'demo@paycheck.app';
  const passwordHash = await bcrypt.hash('demo1234', 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Alex Demo',
      passwordHash,
      paySchedule: 'BIWEEKLY',
    },
  });

  const cats = await prisma.category.findMany({ where: { isSystem: true } });
  const cat = (n: string) => cats.find((c) => c.name === n)!;

  // Recurring bills
  const bills = [
    { name: 'Apartment Rent',  cat: 'Rent / Mortgage',     amount: 1850, dueDay: 1  },
    { name: 'Verizon Wireless', cat: 'Phone',               amount: 75,   dueDay: 5  },
    { name: 'Spectrum Internet', cat: 'Internet',           amount: 60,   dueDay: 8  },
    { name: 'Geico Auto',       cat: 'Car Insurance',      amount: 142,  dueDay: 12 },
    { name: 'Netflix',          cat: 'Subscriptions',      amount: 16,   dueDay: 14 },
    { name: 'Spotify',          cat: 'Subscriptions',      amount: 12,   dueDay: 14 },
  ];
  for (const b of bills) {
    const existing = await prisma.recurringBill.findFirst({
      where: { userId: user.id, name: b.name },
    });
    if (!existing) {
      await prisma.recurringBill.create({
        data: {
          userId: user.id,
          name: b.name,
          categoryId: cat(b.cat).id,
          amount: new Prisma.Decimal(b.amount.toFixed(2)),
          dueDay: b.dueDay,
          frequency: 'MONTHLY',
          paymentMethod: 'BANK_TRANSFER',
        },
      });
    }
  }

  // Current month budget
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const budget = await prisma.budgetMonth.upsert({
    where: { userId_year_month: { userId: user.id, year, month } },
    create: {
      userId: user.id,
      year,
      month,
      plannedIncome: new Prisma.Decimal('5200.00'),
      savingsTarget: new Prisma.Decimal('600.00'),
    },
    update: {},
  });

  // A handful of variable expenses
  const sample = [
    { cat: 'Groceries',   amount: 142.30, day: 3, note: 'Trader Joe\'s', method: 'DEBIT_CARD' as const },
    { cat: 'Gas',         amount: 48.00,  day: 4, note: 'Shell',         method: 'CREDIT_CARD' as const },
    { cat: 'Coffee',      amount: 6.50,   day: 5, note: 'Blue Bottle',   method: 'CREDIT_CARD' as const },
    { cat: 'Dining Out',  amount: 38.40,  day: 7, note: 'Chipotle x2',   method: 'CREDIT_CARD' as const },
    { cat: 'Groceries',   amount: 96.10,  day: 10, note: 'Whole Foods',  method: 'DEBIT_CARD' as const },
    { cat: 'Entertainment', amount: 24.00, day: 12, note: 'Movie night', method: 'CREDIT_CARD' as const },
    { cat: 'Coffee',      amount: 5.75,   day: 13, note: 'Starbucks',    method: 'DEBIT_CARD' as const },
    { cat: 'Dining Out',  amount: 62.10,  day: 15, note: 'Sushi place',  method: 'CREDIT_CARD' as const },
  ];
  for (const s of sample) {
    const date = new Date(Date.UTC(year, month - 1, s.day));
    const exists = await prisma.expense.findFirst({
      where: { userId: user.id, date, amount: new Prisma.Decimal(s.amount.toFixed(2)), note: s.note },
    });
    if (!exists) {
      await prisma.expense.create({
        data: {
          userId: user.id,
          budgetMonthId: budget.id,
          categoryId: cat(s.cat).id,
          amount: new Prisma.Decimal(s.amount.toFixed(2)),
          date,
          note: s.note,
          paymentMethod: s.method,
          type: 'VARIABLE',
        },
      });
    }
  }

  // Sample savings goals
  const goals = [
    { name: 'Emergency Fund', type: 'EMERGENCY_FUND' as const, target: 5000, saved: 1200 },
    { name: 'Trip to Hawaii', type: 'VACATION' as const,        target: 3000, saved: 450  },
  ];
  for (const g of goals) {
    const exists = await prisma.savingsGoal.findFirst({
      where: { userId: user.id, name: g.name },
    });
    if (!exists) {
      await prisma.savingsGoal.create({
        data: {
          userId: user.id,
          name: g.name,
          type: g.type,
          targetAmount: new Prisma.Decimal(g.target.toFixed(2)),
          savedAmount: new Prisma.Decimal(g.saved.toFixed(2)),
        },
      });
    }
  }

  // Sample debts
  const debts = [
    {
      name: 'Chase Sapphire',
      type: 'CREDIT_CARD' as const,
      total: 4200, remaining: 2680, rate: 24.99, min: 95, due: 18,
    },
    {
      name: 'Federal Student Loan',
      type: 'STUDENT_LOAN' as const,
      total: 22000, remaining: 18400, rate: 5.5, min: 220, due: 25,
    },
  ];
  for (const d of debts) {
    const exists = await prisma.debt.findFirst({
      where: { userId: user.id, name: d.name },
    });
    if (!exists) {
      await prisma.debt.create({
        data: {
          userId: user.id,
          name: d.name,
          type: d.type,
          totalAmount: new Prisma.Decimal(d.total.toFixed(2)),
          remainingAmount: new Prisma.Decimal(d.remaining.toFixed(2)),
          interestRate: new Prisma.Decimal(d.rate.toFixed(3)),
          minimumPayment: new Prisma.Decimal(d.min.toFixed(2)),
          dueDay: d.due,
        },
      });
    }
  }

  console.log(`[seed] demo user → ${email} / demo1234`);
}

async function main() {
  await seedSystemCategories();
  await seedDemoUser();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
