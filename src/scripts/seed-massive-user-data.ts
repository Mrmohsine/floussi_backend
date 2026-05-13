import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_USER_ID = 'cmp4bt6uk000012pkh90io3s0';
const SEED_PREFIX = 'seed_massive_v1';
const DEFAULT_MONTHS = 36;

const SYSTEM_CATEGORIES = [
  { name: 'Housing', icon: 'home', color: '#6366F1' },
  { name: 'Groceries', icon: 'shopping-cart', color: '#10B981' },
  { name: 'Gas', icon: 'fuel', color: '#F59E0B' },
  { name: 'Car Payment', icon: 'car', color: '#3B82F6' },
  { name: 'Car Insurance', icon: 'shield', color: '#0EA5E9' },
  { name: 'Health Insurance', icon: 'heart', color: '#EF4444' },
  { name: 'Utilities', icon: 'zap', color: '#FACC15' },
  { name: 'Phone', icon: 'phone', color: '#8B5CF6' },
  { name: 'Internet', icon: 'wifi', color: '#06B6D4' },
  { name: 'Credit Card Payment', icon: 'credit-card', color: '#DC2626' },
  { name: 'Student Loans', icon: 'graduation-cap', color: '#7C3AED' },
  { name: 'Childcare', icon: 'baby', color: '#EC4899' },
  { name: 'Subscriptions', icon: 'play-circle', color: '#F472B6' },
  { name: 'Dining Out', icon: 'utensils', color: '#F97316' },
  { name: 'Coffee', icon: 'coffee', color: '#A16207' },
  { name: 'Shopping', icon: 'shopping-bag', color: '#D946EF' },
  { name: 'Medical', icon: 'stethoscope', color: '#E11D48' },
  { name: 'Entertainment', icon: 'film', color: '#22D3EE' },
  { name: 'Savings', icon: 'piggy-bank', color: '#10B981' },
  { name: 'Emergency Fund', icon: 'shield-alert', color: '#059669' },
  { name: 'Other', icon: 'tag', color: '#6B7280' },
];

type CategoryMap = Map<string, { id: string; name: string }>;
type BankAccountIds = {
  checking: string;
  savings: string;
  credit: string;
  hysa: string;
};

type RecurringBillSeed = {
  slug: string;
  name: string;
  category: string;
  amount: number;
  dueDay: number;
  paymentMethod: string;
  variance?: number;
};

type ExpensePlan = {
  category: string;
  merchants: string[];
  min: number;
  max: number;
  minCount: number;
  maxCount: number;
  methodWeights: Array<[string, number]>;
  primary: string;
  detailed: string;
  channel: string;
};

const recurringBills: RecurringBillSeed[] = [
  { slug: 'rent', name: 'Apartment Rent', category: 'Housing', amount: 1985, dueDay: 1, paymentMethod: 'BANK_TRANSFER' },
  { slug: 'electric', name: 'Electric Bill', category: 'Utilities', amount: 142, dueDay: 6, paymentMethod: 'BANK_TRANSFER', variance: 45 },
  { slug: 'water', name: 'Water and Trash', category: 'Utilities', amount: 68, dueDay: 9, paymentMethod: 'BANK_TRANSFER', variance: 12 },
  { slug: 'internet', name: 'Fiber Internet', category: 'Internet', amount: 79.99, dueDay: 10, paymentMethod: 'CREDIT_CARD' },
  { slug: 'phone', name: 'Mobile Phone Plan', category: 'Phone', amount: 88.75, dueDay: 12, paymentMethod: 'CREDIT_CARD' },
  { slug: 'auto_insurance', name: 'Auto Insurance', category: 'Car Insurance', amount: 164.2, dueDay: 14, paymentMethod: 'BANK_TRANSFER' },
  { slug: 'health_insurance', name: 'Health Insurance', category: 'Health Insurance', amount: 236.44, dueDay: 15, paymentMethod: 'BANK_TRANSFER' },
  { slug: 'car_payment', name: 'Auto Loan Payment', category: 'Car Payment', amount: 438.62, dueDay: 18, paymentMethod: 'BANK_TRANSFER' },
  { slug: 'student_loan', name: 'Student Loan Minimum', category: 'Student Loans', amount: 225, dueDay: 22, paymentMethod: 'BANK_TRANSFER' },
  { slug: 'gym', name: 'City Gym', category: 'Subscriptions', amount: 42, dueDay: 3, paymentMethod: 'CREDIT_CARD' },
  { slug: 'netflix', name: 'Netflix', category: 'Subscriptions', amount: 18.99, dueDay: 4, paymentMethod: 'CREDIT_CARD' },
  { slug: 'spotify', name: 'Spotify', category: 'Subscriptions', amount: 11.99, dueDay: 4, paymentMethod: 'CREDIT_CARD' },
  { slug: 'icloud', name: 'iCloud Storage', category: 'Subscriptions', amount: 2.99, dueDay: 7, paymentMethod: 'CREDIT_CARD' },
  { slug: 'adobe', name: 'Adobe Creative Cloud', category: 'Subscriptions', amount: 59.99, dueDay: 16, paymentMethod: 'CREDIT_CARD' },
  { slug: 'childcare', name: 'After School Program', category: 'Childcare', amount: 310, dueDay: 5, paymentMethod: 'BANK_TRANSFER' },
  { slug: 'credit_card', name: 'Credit Card Autopay', category: 'Credit Card Payment', amount: 550, dueDay: 25, paymentMethod: 'BANK_TRANSFER', variance: 260 },
];

const expensePlans: ExpensePlan[] = [
  {
    category: 'Groceries',
    merchants: ['Trader Joe\'s', 'Costco Wholesale', 'Whole Foods Market', 'Aldi', 'Kroger', 'Walmart Grocery', 'Instacart'],
    min: 28,
    max: 214,
    minCount: 10,
    maxCount: 15,
    methodWeights: [['DEBIT_CARD', 55], ['CREDIT_CARD', 40], ['CASH', 5]],
    primary: 'FOOD_AND_DRINK',
    detailed: 'FOOD_AND_DRINK_GROCERIES',
    channel: 'in store',
  },
  {
    category: 'Dining Out',
    merchants: ['Chipotle', 'Sweetgreen', 'Local Diner', 'Sushi House', 'DoorDash', 'Taco Bell', 'Thai Garden', 'Panera Bread'],
    min: 11,
    max: 96,
    minCount: 13,
    maxCount: 22,
    methodWeights: [['CREDIT_CARD', 70], ['DEBIT_CARD', 25], ['CASH', 5]],
    primary: 'FOOD_AND_DRINK',
    detailed: 'FOOD_AND_DRINK_RESTAURANT',
    channel: 'in store',
  },
  {
    category: 'Coffee',
    merchants: ['Starbucks', 'Blue Bottle Coffee', 'Local Coffee Bar', 'Dunkin', 'Peet\'s Coffee'],
    min: 3.75,
    max: 12.5,
    minCount: 16,
    maxCount: 25,
    methodWeights: [['CREDIT_CARD', 60], ['DEBIT_CARD', 35], ['CASH', 5]],
    primary: 'FOOD_AND_DRINK',
    detailed: 'FOOD_AND_DRINK_COFFEE',
    channel: 'in store',
  },
  {
    category: 'Gas',
    merchants: ['Shell', 'Chevron', 'Exxon', 'Costco Gas', 'BP'],
    min: 33,
    max: 86,
    minCount: 4,
    maxCount: 7,
    methodWeights: [['CREDIT_CARD', 70], ['DEBIT_CARD', 30]],
    primary: 'TRANSPORTATION',
    detailed: 'TRANSPORTATION_GAS',
    channel: 'in store',
  },
  {
    category: 'Shopping',
    merchants: ['Amazon Marketplace', 'Target', 'Best Buy', 'Old Navy', 'Apple Store', 'IKEA', 'HomeGoods'],
    min: 13,
    max: 245,
    minCount: 8,
    maxCount: 14,
    methodWeights: [['CREDIT_CARD', 78], ['DEBIT_CARD', 20], ['BANK_TRANSFER', 2]],
    primary: 'GENERAL_MERCHANDISE',
    detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
    channel: 'online',
  },
  {
    category: 'Entertainment',
    merchants: ['AMC Theatres', 'Live Nation', 'Steam Games', 'Bowling Alley', 'Museum Tickets', 'Audible', 'Nintendo eShop'],
    min: 9,
    max: 185,
    minCount: 4,
    maxCount: 9,
    methodWeights: [['CREDIT_CARD', 75], ['DEBIT_CARD', 25]],
    primary: 'ENTERTAINMENT',
    detailed: 'ENTERTAINMENT_OTHER_ENTERTAINMENT',
    channel: 'online',
  },
  {
    category: 'Medical',
    merchants: ['CVS Pharmacy', 'Walgreens', 'City Dental', 'Urgent Care Copay', 'Vision Center'],
    min: 8,
    max: 180,
    minCount: 1,
    maxCount: 4,
    methodWeights: [['CREDIT_CARD', 55], ['DEBIT_CARD', 45]],
    primary: 'MEDICAL',
    detailed: 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
    channel: 'in store',
  },
  {
    category: 'Other',
    merchants: ['Parking Meter', 'USPS', 'Haircut', 'ATM Fee', 'Dry Cleaning', 'Hardware Store', 'Pet Supplies'],
    min: 4,
    max: 95,
    minCount: 9,
    maxCount: 16,
    methodWeights: [['DEBIT_CARD', 45], ['CREDIT_CARD', 40], ['CASH', 15]],
    primary: 'GENERAL_SERVICES',
    detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
    channel: 'in store',
  },
  {
    category: 'Utilities',
    merchants: ['City Parking Permit', 'Public Transit Pass', 'Toll Authority'],
    min: 7,
    max: 128,
    minCount: 2,
    maxCount: 5,
    methodWeights: [['CREDIT_CARD', 50], ['DEBIT_CARD', 50]],
    primary: 'TRANSPORTATION',
    detailed: 'TRANSPORTATION_PUBLIC_TRANSIT',
    channel: 'online',
  },
];

function normalizeCategoryName(name: string) {
  return name.trim().toLowerCase();
}

function userKey(userId: string) {
  return createHash('sha1').update(userId).digest('hex').slice(0, 10);
}

function makeId(scope: string, kind: string, ...parts: Array<string | number>) {
  return [SEED_PREFIX, scope, kind, ...parts]
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 180);
}

function seedNumber(input: string) {
  const hash = createHash('sha256').update(input).digest();
  return hash.readUInt32LE(0);
}

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand: () => number, min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomAmount(rand: () => number, min: number, max: number) {
  return Number((min + rand() * (max - min)).toFixed(2));
}

function pick<T>(rand: () => number, values: T[]) {
  return values[Math.floor(rand() * values.length)];
}

function pickWeighted(rand: () => number, weights: Array<[string, number]>) {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rand() * total;
  for (const [value, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

function money(amount: number) {
  return amount.toFixed(2);
}

function decimal(amount: number) {
  return new Prisma.Decimal(money(amount));
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function utcDate(year: number, monthIndex: number, day: number, hour = 12, minute = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute));
}

function addMonths(year: number, monthIndex: number, delta: number) {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
}

function monthCode(year: number, monthIndex: number) {
  return `${year}${String(monthIndex + 1).padStart(2, '0')}`;
}

function monthKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

async function createManyInChunks<T>(
  model: { createMany: (args: { data: T[]; skipDuplicates?: boolean }) => Promise<unknown> },
  data: T[],
  chunkSize = 500,
) {
  for (let i = 0; i < data.length; i += chunkSize) {
    await model.createMany({ data: data.slice(i, i + chunkSize), skipDuplicates: true });
  }
}

async function ensureSystemCategories() {
  for (const category of SYSTEM_CATEGORIES) {
    await prisma.category.upsert({
      where: { normalizedName: normalizeCategoryName(category.name) },
      create: {
        ...category,
        normalizedName: normalizeCategoryName(category.name),
        isSystem: true,
      },
      update: {
        icon: category.icon,
        color: category.color,
        isSystem: true,
      },
    });
  }

  return prisma.category.findMany({
    where: { name: { in: SYSTEM_CATEGORIES.map((c) => c.name) } },
    select: { id: true, name: true },
  });
}

async function cleanupPreviousSeed(userId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { userId, id: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });
  const items = await prisma.plaidItem.findMany({
    where: { userId, id: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });

  const conversationIds = conversations.map((c) => c.id);
  const itemIds = items.map((i) => i.id);

  await prisma.bankTransaction.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  if (itemIds.length > 0) {
    await prisma.plaidAccount.deleteMany({ where: { itemId: { in: itemIds } } });
  }
  await prisma.plaidItem.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  if (conversationIds.length > 0) {
    await prisma.chatMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
  }
  await prisma.conversation.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.notification.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.expense.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.income.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.recurringBill.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.savingsGoal.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.debt.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
  await prisma.budgetMonth.deleteMany({ where: { userId, id: { startsWith: SEED_PREFIX } } });
}

function getCategoryId(categories: CategoryMap, name: string) {
  return categories.get(name)?.id ?? categories.get('Other')!.id;
}

async function seedPlaidAccounts(userId: string, scope: string) {
  const now = new Date();
  const chaseItemId = makeId(scope, 'plaid_item', 'chase');
  const allyItemId = makeId(scope, 'plaid_item', 'ally');

  await prisma.plaidItem.createMany({
    skipDuplicates: true,
    data: [
      {
        id: chaseItemId,
        userId,
        plaidItemId: `plaid-${scope}-chase`,
        accessToken: `access-${scope}-chase-synthetic`,
        institutionId: 'ins_3',
        institutionName: 'Chase',
        syncCursor: `cursor-${scope}-chase`,
        lastSyncedAt: now,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: allyItemId,
        userId,
        plaidItemId: `plaid-${scope}-ally`,
        accessToken: `access-${scope}-ally-synthetic`,
        institutionId: 'ins_127991',
        institutionName: 'Ally Bank',
        syncCursor: `cursor-${scope}-ally`,
        lastSyncedAt: now,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  const accounts: BankAccountIds = {
    checking: makeId(scope, 'acct', 'chase_checking'),
    savings: makeId(scope, 'acct', 'chase_savings'),
    credit: makeId(scope, 'acct', 'chase_credit'),
    hysa: makeId(scope, 'acct', 'ally_hysa'),
  };

  await prisma.plaidAccount.createMany({
    skipDuplicates: true,
    data: [
      {
        id: accounts.checking,
        itemId: chaseItemId,
        plaidAccountId: `plaid-${scope}-checking`,
        name: 'Everyday Checking',
        officialName: 'Chase Total Checking',
        mask: '0421',
        type: 'depository',
        subtype: 'checking',
        balanceCurrent: decimal(8426.32),
        balanceAvailable: decimal(8126.32),
        isoCurrencyCode: 'USD',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: accounts.savings,
        itemId: chaseItemId,
        plaidAccountId: `plaid-${scope}-savings`,
        name: 'Short Term Savings',
        officialName: 'Chase Savings',
        mask: '7710',
        type: 'depository',
        subtype: 'savings',
        balanceCurrent: decimal(6420.18),
        balanceAvailable: decimal(6420.18),
        isoCurrencyCode: 'USD',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: accounts.credit,
        itemId: chaseItemId,
        plaidAccountId: `plaid-${scope}-credit`,
        name: 'Freedom Unlimited',
        officialName: 'Chase Freedom Unlimited',
        mask: '1884',
        type: 'credit',
        subtype: 'credit card',
        balanceCurrent: decimal(1846.51),
        balanceAvailable: decimal(8153.49),
        isoCurrencyCode: 'USD',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: accounts.hysa,
        itemId: allyItemId,
        plaidAccountId: `plaid-${scope}-hysa`,
        name: 'High Yield Savings',
        officialName: 'Ally Online Savings',
        mask: '3307',
        type: 'depository',
        subtype: 'savings',
        balanceCurrent: decimal(18490.74),
        balanceAvailable: decimal(18490.74),
        isoCurrencyCode: 'USD',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  return {
    items: {
      chase: chaseItemId,
      ally: allyItemId,
    },
    accounts,
  };
}

async function seedRecurringBills(userId: string, scope: string, categories: CategoryMap) {
  await prisma.recurringBill.createMany({
    skipDuplicates: true,
    data: recurringBills.map((bill) => {
      const now = new Date();
      return {
        id: makeId(scope, 'recurring', bill.slug),
        userId,
        categoryId: getCategoryId(categories, bill.category),
        name: bill.name,
        amount: decimal(bill.amount),
        frequency: 'MONTHLY',
        dueDay: bill.dueDay,
        active: true,
        paymentMethod: bill.paymentMethod,
        note: 'Realistic synthetic seed template',
        createdAt: now,
        updatedAt: now,
      };
    }),
  });
}

function accountForPayment(accounts: BankAccountIds, paymentMethod: string) {
  if (paymentMethod === 'CREDIT_CARD') return accounts.credit;
  if (paymentMethod === 'BANK_TRANSFER') return accounts.checking;
  return accounts.checking;
}

function itemForAccount(plaidIds: { items: { chase: string; ally: string }; accounts: BankAccountIds }, accountId: string) {
  return accountId === plaidIds.accounts.hysa ? plaidIds.items.ally : plaidIds.items.chase;
}

async function seedMonthlyLedger(
  userId: string,
  scope: string,
  categories: CategoryMap,
  plaidIds: { items: { chase: string; ally: string }; accounts: BankAccountIds },
  months: number,
) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonthIndex = now.getUTCMonth();
  const currentDay = now.getUTCDate();
  const oldest = addMonths(currentYear, currentMonthIndex, -(months - 1));
  const rand = mulberry32(seedNumber(`${userId}:ledger:${months}`));

  const incomeRows: Prisma.IncomeCreateManyInput[] = [];
  const expenseRows: Prisma.ExpenseCreateManyInput[] = [];
  const bankRows: Prisma.BankTransactionCreateManyInput[] = [];
  let incomeCount = 0;
  let expenseCount = 0;
  let transferCount = 0;

  for (let monthOffset = 0; monthOffset < months; monthOffset += 1) {
    const { year, monthIndex } = addMonths(oldest.year, oldest.monthIndex, monthOffset);
    const code = monthCode(year, monthIndex);
    const month = monthIndex + 1;
    const fullDays = daysInMonth(year, monthIndex);
    const isCurrentMonth = year === currentYear && monthIndex === currentMonthIndex;
    const lastDay = isCurrentMonth ? currentDay : fullDays;
    const progress = monthOffset / Math.max(months - 1, 1);
    const mainPay = 2440 + progress * 380 + randomAmount(rand, -90, 120);
    const sideGigExpected = 560 + progress * 160;
    const plannedIncome = mainPay * 2 + sideGigExpected + 55;
    const savingsTarget = 650 + progress * 250 + randomAmount(rand, -90, 160);

    const budget = await prisma.budgetMonth.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: {
        id: makeId(scope, 'budget', code),
        userId,
        year,
        month,
        plannedIncome: decimal(plannedIncome),
        savingsTarget: decimal(Math.max(300, savingsTarget)),
        notes: 'Realistic synthetic seed: payroll, bills, everyday spending, transfers, and bank activity.',
        createdAt: utcDate(year, monthIndex, 1),
        updatedAt: now,
      },
      update: {
        plannedIncome: decimal(plannedIncome),
        savingsTarget: decimal(Math.max(300, savingsTarget)),
        notes: 'Realistic synthetic seed: payroll, bills, everyday spending, transfers, and bank activity.',
      },
    });

    const incomeSeeds = [
      { slug: 'paycheck_1', source: 'Northstar Payroll', amount: mainPay, day: 1 },
      { slug: 'paycheck_2', source: 'Northstar Payroll', amount: mainPay + randomAmount(rand, -65, 95), day: 15 },
      { slug: 'freelance', source: 'Freelance Design Client', amount: randomAmount(rand, 240, 980), day: randomInt(rand, 17, Math.min(27, fullDays)), chance: 0.82 },
      { slug: 'interest', source: 'High Yield Savings Interest', amount: randomAmount(rand, 12, 68), day: fullDays, chance: 1 },
      { slug: 'cashback', source: 'Credit Card Rewards', amount: randomAmount(rand, 18, 95), day: randomInt(rand, 5, Math.min(26, fullDays)), chance: 0.55 },
    ];

    for (const seed of incomeSeeds) {
      if (seed.day > lastDay) continue;
      if (seed.chance !== undefined && rand() > seed.chance) continue;
      const rowId = makeId(scope, 'income', code, seed.slug);
      const receivedAt = utcDate(year, monthIndex, seed.day, 9, randomInt(rand, 0, 59));
      incomeRows.push({
        id: rowId,
        userId,
        budgetMonthId: budget.id,
        amount: decimal(seed.amount),
        source: seed.source,
        receivedAt,
        note: 'Realistic synthetic deposit',
        createdAt: receivedAt,
      });
      bankRows.push({
        id: makeId(scope, 'btx', code, 'income', seed.slug),
        userId,
        itemId: seed.slug === 'interest' ? plaidIds.items.ally : plaidIds.items.chase,
        accountId: seed.slug === 'interest' ? plaidIds.accounts.hysa : plaidIds.accounts.checking,
        plaidTransactionId: `plaid-${makeId(scope, 'btx', code, 'income', seed.slug)}`,
        amount: decimal(-seed.amount),
        isoCurrencyCode: 'USD',
        date: receivedAt,
        authorizedDate: receivedAt,
        name: seed.source.toUpperCase(),
        merchantName: seed.source,
        category: 'INCOME',
        categoryDetailed: 'INCOME_WAGES',
        pending: false,
        paymentChannel: 'other',
        incomeId: rowId,
        createdAt: receivedAt,
        updatedAt: now,
      });
      incomeCount += 1;
    }

    for (const bill of recurringBills) {
      if (bill.dueDay > lastDay) continue;
      const billAmount = bill.variance
        ? Math.max(1, bill.amount + randomAmount(rand, -bill.variance, bill.variance))
        : bill.amount;
      const rowId = makeId(scope, 'expense', code, 'bill', bill.slug);
      const paidAt = utcDate(year, monthIndex, Math.min(bill.dueDay, fullDays), 10, randomInt(rand, 0, 59));
      const accountId = accountForPayment(plaidIds.accounts, bill.paymentMethod);
      expenseRows.push({
        id: rowId,
        userId,
        categoryId: getCategoryId(categories, bill.category),
        budgetMonthId: budget.id,
        amount: decimal(billAmount),
        date: paidAt,
        note: bill.name,
        paymentMethod: bill.paymentMethod,
        type: 'FIXED_BILL',
        recurringBillId: makeId(scope, 'recurring', bill.slug),
        createdAt: paidAt,
        updatedAt: now,
      });
      bankRows.push({
        id: makeId(scope, 'btx', code, 'bill', bill.slug),
        userId,
        itemId: itemForAccount(plaidIds, accountId),
        accountId,
        plaidTransactionId: `plaid-${makeId(scope, 'btx', code, 'bill', bill.slug)}`,
        amount: decimal(billAmount),
        isoCurrencyCode: 'USD',
        date: paidAt,
        authorizedDate: paidAt,
        name: bill.name.toUpperCase(),
        merchantName: bill.name,
        category: bill.category === 'Subscriptions' ? 'ENTERTAINMENT' : 'RENT_AND_UTILITIES',
        categoryDetailed: bill.category === 'Housing'
          ? 'RENT_AND_UTILITIES_RENT'
          : bill.category === 'Internet'
            ? 'RENT_AND_UTILITIES_INTERNET_AND_CABLE'
            : bill.category === 'Phone'
              ? 'RENT_AND_UTILITIES_TELEPHONE'
              : 'RENT_AND_UTILITIES_OTHER_UTILITIES',
        pending: false,
        paymentChannel: bill.paymentMethod === 'BANK_TRANSFER' ? 'online' : 'other',
        expenseId: rowId,
        createdAt: paidAt,
        updatedAt: now,
      });
      expenseCount += 1;
    }

    let variableIndex = 0;
    const monthScale = isCurrentMonth ? Math.max(0.25, lastDay / fullDays) : 1;
    for (const plan of expensePlans) {
      const plannedCount = randomInt(rand, plan.minCount, plan.maxCount);
      const count = Math.max(1, Math.round(plannedCount * monthScale));
      for (let i = 0; i < count; i += 1) {
        variableIndex += 1;
        const rowId = makeId(scope, 'expense', code, 'var', String(variableIndex).padStart(3, '0'));
        const day = randomInt(rand, 1, Math.max(1, lastDay));
        const spentAt = utcDate(year, monthIndex, day, randomInt(rand, 8, 22), randomInt(rand, 0, 59));
        const merchant = pick(rand, plan.merchants);
        const amount = randomAmount(rand, plan.min, plan.max);
        const paymentMethod = pickWeighted(rand, plan.methodWeights);
        const accountId = accountForPayment(plaidIds.accounts, paymentMethod);
        expenseRows.push({
          id: rowId,
          userId,
          categoryId: getCategoryId(categories, plan.category),
          budgetMonthId: budget.id,
          amount: decimal(amount),
          date: spentAt,
          note: merchant,
          paymentMethod,
          type: 'VARIABLE',
          createdAt: spentAt,
          updatedAt: now,
        });
        bankRows.push({
          id: makeId(scope, 'btx', code, 'var', String(variableIndex).padStart(3, '0')),
          userId,
          itemId: itemForAccount(plaidIds, accountId),
          accountId,
          plaidTransactionId: `plaid-${makeId(scope, 'btx', code, 'var', String(variableIndex).padStart(3, '0'))}`,
          amount: decimal(amount),
          isoCurrencyCode: 'USD',
          date: spentAt,
          authorizedDate: spentAt,
          name: merchant.toUpperCase(),
          merchantName: merchant,
          category: plan.primary,
          categoryDetailed: plan.detailed,
          pending: false,
          paymentChannel: plan.channel,
          expenseId: rowId,
          createdAt: spentAt,
          updatedAt: now,
        });
        expenseCount += 1;
      }
    }

    const savingsTransfer = Math.max(250, savingsTarget + randomAmount(rand, -120, 180));
    const transferDay = Math.min(lastDay, randomInt(rand, 2, Math.min(22, fullDays)));
    const transferAt = utcDate(year, monthIndex, transferDay, 13, randomInt(rand, 0, 59));
    const transferSlug = String(transferCount).padStart(4, '0');
    bankRows.push(
      {
        id: makeId(scope, 'btx', code, 'transfer_out', transferSlug),
        userId,
        itemId: plaidIds.items.chase,
        accountId: plaidIds.accounts.checking,
        plaidTransactionId: `plaid-${makeId(scope, 'btx', code, 'transfer_out', transferSlug)}`,
        amount: decimal(savingsTransfer),
        isoCurrencyCode: 'USD',
        date: transferAt,
        authorizedDate: transferAt,
        name: 'ONLINE TRANSFER TO SAVINGS',
        merchantName: 'Internal Transfer',
        category: 'TRANSFER_OUT',
        categoryDetailed: 'TRANSFER_OUT_SAVINGS',
        pending: false,
        paymentChannel: 'online',
        createdAt: transferAt,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'btx', code, 'transfer_in', transferSlug),
        userId,
        itemId: plaidIds.items.ally,
        accountId: plaidIds.accounts.hysa,
        plaidTransactionId: `plaid-${makeId(scope, 'btx', code, 'transfer_in', transferSlug)}`,
        amount: decimal(-savingsTransfer),
        isoCurrencyCode: 'USD',
        date: transferAt,
        authorizedDate: transferAt,
        name: 'ONLINE TRANSFER FROM CHECKING',
        merchantName: 'Internal Transfer',
        category: 'TRANSFER_IN',
        categoryDetailed: 'TRANSFER_IN_SAVINGS',
        pending: false,
        paymentChannel: 'online',
        createdAt: transferAt,
        updatedAt: now,
      },
    );
    transferCount += 1;
  }

  await createManyInChunks(prisma.income, incomeRows);
  await createManyInChunks(prisma.expense, expenseRows);
  await createManyInChunks(prisma.bankTransaction, bankRows);

  return {
    budgetMonths: months,
    incomes: incomeCount,
    expenses: expenseCount,
    bankTransactions: bankRows.length,
  };
}

async function seedGoalsAndDebts(userId: string, scope: string) {
  const now = new Date();
  await prisma.savingsGoal.createMany({
    skipDuplicates: true,
    data: [
      {
        id: makeId(scope, 'goal', 'emergency'),
        userId,
        name: 'Emergency Fund',
        type: 'EMERGENCY_FUND',
        targetAmount: decimal(30000),
        savedAmount: decimal(18650),
        targetDate: new Date(Date.UTC(2026, 11, 31)),
        icon: 'shield-alert',
        color: '#059669',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'goal', 'house'),
        userId,
        name: 'House Down Payment',
        type: 'HOUSE_DOWN_PAYMENT',
        targetAmount: decimal(65000),
        savedAmount: decimal(21420),
        targetDate: new Date(Date.UTC(2028, 5, 1)),
        icon: 'home',
        color: '#6366F1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'goal', 'vacation'),
        userId,
        name: 'Summer Vacation',
        type: 'VACATION',
        targetAmount: decimal(4200),
        savedAmount: decimal(3125),
        targetDate: new Date(Date.UTC(2026, 6, 15)),
        icon: 'piggy-bank',
        color: '#0EA5E9',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'goal', 'car'),
        userId,
        name: 'Next Car Fund',
        type: 'CAR_DOWN_PAYMENT',
        targetAmount: decimal(9000),
        savedAmount: decimal(2870),
        targetDate: new Date(Date.UTC(2027, 2, 1)),
        icon: 'car',
        color: '#3B82F6',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'goal', 'tax'),
        userId,
        name: 'Freelance Tax Cushion',
        type: 'OTHER',
        targetAmount: decimal(5500),
        savedAmount: decimal(1980),
        targetDate: new Date(Date.UTC(2027, 3, 15)),
        icon: 'piggy-bank',
        color: '#F59E0B',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'goal', 'debt_payoff'),
        userId,
        name: 'Debt Snowball Buffer',
        type: 'DEBT_PAYOFF',
        targetAmount: decimal(7500),
        savedAmount: decimal(1650),
        targetDate: new Date(Date.UTC(2027, 8, 1)),
        icon: 'credit-card',
        color: '#DC2626',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  await prisma.debt.createMany({
    skipDuplicates: true,
    data: [
      {
        id: makeId(scope, 'debt', 'chase'),
        userId,
        name: 'Chase Freedom Unlimited',
        type: 'CREDIT_CARD',
        totalAmount: decimal(7200),
        remainingAmount: decimal(1846.51),
        interestRate: new Prisma.Decimal('24.990'),
        minimumPayment: decimal(72),
        dueDay: 25,
        payoffDate: new Date(Date.UTC(2026, 9, 1)),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'debt', 'student'),
        userId,
        name: 'Federal Student Loan',
        type: 'STUDENT_LOAN',
        totalAmount: decimal(28000),
        remainingAmount: decimal(16940.33),
        interestRate: new Prisma.Decimal('5.500'),
        minimumPayment: decimal(225),
        dueDay: 22,
        payoffDate: new Date(Date.UTC(2031, 4, 1)),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'debt', 'auto'),
        userId,
        name: 'Auto Loan',
        type: 'AUTO_LOAN',
        totalAmount: decimal(26500),
        remainingAmount: decimal(11280.07),
        interestRate: new Prisma.Decimal('6.490'),
        minimumPayment: decimal(438.62),
        dueDay: 18,
        payoffDate: new Date(Date.UTC(2028, 0, 1)),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'debt', 'personal'),
        userId,
        name: 'Home Repair Personal Loan',
        type: 'PERSONAL_LOAN',
        totalAmount: decimal(9500),
        remainingAmount: decimal(3920.12),
        interestRate: new Prisma.Decimal('10.750'),
        minimumPayment: decimal(191.4),
        dueDay: 11,
        payoffDate: new Date(Date.UTC(2027, 1, 1)),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId(scope, 'debt', 'medical'),
        userId,
        name: 'Dental Payment Plan',
        type: 'MEDICAL',
        totalAmount: decimal(2400),
        remainingAmount: decimal(620),
        interestRate: new Prisma.Decimal('0.000'),
        minimumPayment: decimal(80),
        dueDay: 8,
        payoffDate: new Date(Date.UTC(2026, 11, 1)),
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

async function seedConversations(userId: string, scope: string) {
  const now = new Date();
  const conversations = [
    {
      slug: 'budget_review',
      title: 'Monthly budget review',
      messages: [
        ['user', 'Can you review my current month and tell me what is driving spending?'],
        ['assistant', 'Dining, groceries, and shopping are the biggest flexible categories. Fixed bills are stable, so the opportunity is in day-to-day purchases.'],
        ['user', 'How much should I move to savings this week?'],
        ['assistant', 'A transfer around $420 keeps your checking cushion healthy while still moving you toward the Emergency Fund and House Down Payment goals.'],
        ['user', 'What is the one change with the biggest impact?'],
        ['assistant', 'Cap food delivery to twice this week. Based on recent averages, that saves about $110 without touching essentials.'],
      ],
    },
    {
      slug: 'debt_plan',
      title: 'Debt payoff plan',
      messages: [
        ['user', 'Which debt should I attack first?'],
        ['assistant', 'The Chase Freedom Unlimited card has the highest APR, so extra payments there give the strongest return.'],
        ['user', 'Can I still save while paying it down?'],
        ['assistant', 'Yes. Keep the emergency transfer automated, then send extra leftover cash to the card after bills clear.'],
        ['user', 'What extra payment would make a difference?'],
        ['assistant', 'An extra $250 per month could bring the payoff date meaningfully closer and reduce interest pressure.'],
      ],
    },
    {
      slug: 'bank_sync',
      title: 'Connected bank cleanup',
      messages: [
        ['user', 'Are the bank transactions matching my budget categories?'],
        ['assistant', 'Most grocery, dining, gas, and subscription transactions are mapped cleanly. A few general service transactions may need manual review.'],
        ['user', 'What should I check first?'],
        ['assistant', 'Look at large Amazon and Target purchases because they can mix groceries, household goods, and discretionary shopping.'],
      ],
    },
    {
      slug: 'savings_goals',
      title: 'Savings goals pacing',
      messages: [
        ['user', 'Am I on track for my vacation goal?'],
        ['assistant', 'You are close. A $275 transfer this month should keep the Summer Vacation goal on pace.'],
        ['user', 'What about the house down payment?'],
        ['assistant', 'That one needs a longer runway. Your current savings pace is solid, but bonuses and freelance income will matter most.'],
      ],
    },
    {
      slug: 'subscriptions',
      title: 'Subscription audit',
      messages: [
        ['user', 'Show me subscriptions that are worth checking.'],
        ['assistant', 'Netflix, Spotify, iCloud, Adobe, and the gym are recurring every month. Adobe and the gym are the largest nonessential subscriptions.'],
        ['user', 'Which one should I cancel?'],
        ['assistant', 'If Adobe is not tied to freelance work, that is the cleanest savings. If it supports paid work, keep it and review the gym instead.'],
      ],
    },
    {
      slug: 'cashflow',
      title: 'Cashflow timing',
      messages: [
        ['user', 'Do I have any tight cashflow windows?'],
        ['assistant', 'The first week is busiest because rent, childcare, gym, streaming, and utilities land close together.'],
        ['user', 'How can I smooth that out?'],
        ['assistant', 'Keep a first-week buffer in checking and move savings after the second paycheck instead of immediately after rent.'],
      ],
    },
  ];

  const conversationRows: Prisma.ConversationCreateManyInput[] = [];
  const messageRows: Prisma.ChatMessageCreateManyInput[] = [];

  conversations.forEach((conversation, index) => {
    const createdAt = new Date(now.getTime() - (conversations.length - index) * 5 * 24 * 60 * 60 * 1000);
    const conversationId = makeId(scope, 'conversation', conversation.slug);
    conversationRows.push({
      id: conversationId,
      userId,
      title: conversation.title,
      createdAt,
      updatedAt: new Date(createdAt.getTime() + conversation.messages.length * 5 * 60 * 1000),
    });

    conversation.messages.forEach(([role, content], messageIndex) => {
      messageRows.push({
        id: makeId(scope, 'message', conversation.slug, messageIndex),
        conversationId,
        role,
        content,
        createdAt: new Date(createdAt.getTime() + messageIndex * 5 * 60 * 1000),
      });
    });
  });

  await prisma.conversation.createMany({ data: conversationRows, skipDuplicates: true });
  await prisma.chatMessage.createMany({ data: messageRows, skipDuplicates: true });
}

async function seedNotifications(userId: string, scope: string, months: number) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonthIndex = now.getUTCMonth();
  const oldest = addMonths(currentYear, currentMonthIndex, -Math.min(months - 1, 11));
  const rows: Prisma.NotificationCreateManyInput[] = [];

  const templates = [
    ['warning', 'Dining out is adding up', 'Restaurants and delivery are above the usual monthly pace.', 'Review dining', 82],
    ['positive', 'Savings transfer completed', 'Your automated savings transfer kept your goals moving.', 'View goals', 74],
    ['info', 'Bank sync is fresh', 'Connected bank balances and transactions are up to date.', 'View banks', 55],
    ['alert', 'High APR debt deserves attention', 'Extra payments on the credit card save the most interest.', 'View debts', 92],
    ['warning', 'First-week bills are clustered', 'Rent, utilities, subscriptions, and childcare are close together.', 'Review budget', 78],
    ['positive', 'Income covered planned bills', 'Paychecks and side income covered this month\'s fixed obligations.', 'View income', 70],
    ['info', 'Subscription check', 'A quick subscription audit could free up more savings.', 'Review bills', 58],
    ['warning', 'Shopping is running warm', 'General merchandise purchases are higher than the trailing average.', 'Review spending', 80],
  ] as const;

  for (let monthOffset = 0; monthOffset < Math.min(months, 12); monthOffset += 1) {
    const { year, monthIndex } = addMonths(oldest.year, oldest.monthIndex, monthOffset);
    const key = monthKey(year, monthIndex);
    templates.forEach(([tone, title, body, actionLabel, priority], templateIndex) => {
      const createdAt = utcDate(year, monthIndex, Math.min(24, 3 + templateIndex * 3), 8 + (templateIndex % 8));
      rows.push({
        id: makeId(scope, 'notification', key, templateIndex),
        userId,
        monthKey: key,
        sourceId: makeId(scope, 'notification_source', key, templateIndex),
        tone,
        title,
        body,
        actionLabel,
        priority,
        fingerprint: createHash('sha256').update(`${userId}:${key}:${templateIndex}:${title}`).digest('hex'),
        aiEnhancedAt: templateIndex % 3 === 0 ? createdAt : null,
        readAt: key === monthKey(currentYear, currentMonthIndex) && templateIndex < 4 ? null : new Date(createdAt.getTime() + 2 * 24 * 60 * 60 * 1000),
        createdAt,
        updatedAt: createdAt,
      });
    });
  }

  await createManyInChunks(prisma.notification, rows);
}

async function main() {
  const userId = process.argv[2] ?? DEFAULT_USER_ID;
  const parsedMonths = Number(process.argv[3] ?? process.env.MASSIVE_SEED_MONTHS ?? DEFAULT_MONTHS);
  const months = Number.isFinite(parsedMonths) ? Math.max(1, Math.min(72, Math.round(parsedMonths))) : DEFAULT_MONTHS;
  const scope = userKey(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    throw new Error(`User ${userId} not found.`);
  }

  console.log(`[seed] Target user: ${user.email} (${user.id})`);
  console.log(`[seed] Months: ${months}`);
  console.log('[seed] Ensuring categories...');
  const categoriesList = await ensureSystemCategories();
  const categories = new Map(categoriesList.map((c) => [c.name, c]));

  console.log('[seed] Linking categories to user...');
  for (const category of categoriesList) {
    await prisma.userCategory.upsert({
      where: { userId_categoryId: { userId, categoryId: category.id } },
      create: { userId, categoryId: category.id },
      update: {},
    });
  }

  console.log('[seed] Cleaning previous massive seed rows for this user...');
  await cleanupPreviousSeed(userId);

  console.log('[seed] Creating connected banks...');
  const plaidIds = await seedPlaidAccounts(userId, scope);

  console.log('[seed] Creating recurring bills...');
  await seedRecurringBills(userId, scope, categories);

  console.log('[seed] Creating monthly budgets, ledger rows, and bank transactions...');
  const ledgerSummary = await seedMonthlyLedger(userId, scope, categories, plaidIds, months);

  console.log('[seed] Creating goals, debts, conversations, and notifications...');
  await seedGoalsAndDebts(userId, scope);
  await seedConversations(userId, scope);
  await seedNotifications(userId, scope, months);

  const counts = {
    budgetMonths: await prisma.budgetMonth.count({ where: { userId } }),
    incomes: await prisma.income.count({ where: { userId } }),
    expenses: await prisma.expense.count({ where: { userId } }),
    savingsGoals: await prisma.savingsGoal.count({ where: { userId } }),
    debts: await prisma.debt.count({ where: { userId } }),
    recurringBills: await prisma.recurringBill.count({ where: { userId } }),
    plaidItems: await prisma.plaidItem.count({ where: { userId } }),
    plaidAccounts: await prisma.plaidAccount.count({ where: { item: { userId } } }),
    bankTransactions: await prisma.bankTransaction.count({ where: { userId } }),
    conversations: await prisma.conversation.count({ where: { userId } }),
    chatMessages: await prisma.chatMessage.count({ where: { conversation: { userId } } }),
    notifications: await prisma.notification.count({ where: { userId } }),
  };

  console.log('[seed] Inserted ledger summary:', JSON.stringify(ledgerSummary, null, 2));
  console.log('[seed] Final user counts:', JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
