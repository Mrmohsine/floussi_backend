import { Router } from 'express';
import { z } from 'zod';
import { CountryCode, Products, type Transaction, type RemovedTransaction } from 'plaid';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { notFound } from '../../utils/errors';
import { plaid } from './plaid.client';

const router = Router();
router.use(requireAuth);

// ──────────────────────────────────────────────────────────────────────
// POST /api/plaid/link-token
// Creates a short-lived link_token the mobile app passes into Plaid Link.
// Plaid scopes the token to this specific user via `client_user_id`.
// ──────────────────────────────────────────────────────────────────────
router.post(
  '/link-token',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const response = await plaid().linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Floussi',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca, CountryCode.Gb],
      language: 'en',
    });
    res.json({
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    });
  }),
);

// ──────────────────────────────────────────────────────────────────────
// POST /api/plaid/exchange-token
// Mobile sends `publicToken` after a successful Plaid Link flow. We
// swap it for an access_token (long-lived) and persist the Item +
// accounts. Institution metadata is best-effort — sandbox returns it.
// ──────────────────────────────────────────────────────────────────────
const exchangeSchema = z.object({
  publicToken: z.string().min(10).max(500),
  institutionId: z.string().optional(),
  institutionName: z.string().optional(),
});

router.post(
  '/exchange-token',
  validate(exchangeSchema),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { publicToken, institutionId, institutionName } = req.body as z.infer<typeof exchangeSchema>;

    const client = plaid();
    const exchange = await client.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const plaidItemId = exchange.data.item_id;

    // Resolve institution name when client didn't pass one through.
    let resolvedInstId = institutionId ?? null;
    let resolvedInstName = institutionName ?? null;
    if (!resolvedInstName) {
      try {
        const item = await client.itemGet({ access_token: accessToken });
        resolvedInstId = item.data.item.institution_id ?? resolvedInstId;
        if (resolvedInstId) {
          const inst = await client.institutionsGetById({
            institution_id: resolvedInstId,
            country_codes: [CountryCode.Us, CountryCode.Ca, CountryCode.Gb],
          });
          resolvedInstName = inst.data.institution.name;
        }
      } catch {
        // best-effort — Item still works without institution metadata
      }
    }

    const accountsRes = await client.accountsGet({ access_token: accessToken });
    const accounts = accountsRes.data.accounts;

    const item = await prisma.plaidItem.create({
      data: {
        userId,
        plaidItemId,
        accessToken,
        institutionId: resolvedInstId,
        institutionName: resolvedInstName,
        accounts: {
          create: accounts.map((a) => ({
            plaidAccountId: a.account_id,
            name: a.name,
            officialName: a.official_name ?? null,
            mask: a.mask ?? null,
            type: a.type,
            subtype: a.subtype ?? null,
            balanceCurrent: a.balances.current != null ? new Prisma.Decimal(a.balances.current) : null,
            balanceAvailable: a.balances.available != null ? new Prisma.Decimal(a.balances.available) : null,
            isoCurrencyCode: a.balances.iso_currency_code ?? null,
          })),
        },
      },
      include: { accounts: true },
    });

    res.json({ item: serializeItem(item) });
  }),
);

// ──────────────────────────────────────────────────────────────────────
// GET /api/plaid/items — list this user's linked institutions + accounts.
// ──────────────────────────────────────────────────────────────────────
router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const items = await prisma.plaidItem.findMany({
      where: { userId, status: { not: 'REMOVED' } },
      include: { accounts: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items: items.map(serializeItem) });
  }),
);

// ──────────────────────────────────────────────────────────────────────
// DELETE /api/plaid/items/:id — disconnect an institution.
// Calls Plaid /item/remove (invalidates the access_token) then deletes
// locally. We tolerate Plaid errors so the user can always clean up
// stale rows.
// ──────────────────────────────────────────────────────────────────────
router.delete(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const item = await prisma.plaidItem.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!item) throw notFound('Item not found');

    try {
      await plaid().itemRemove({ access_token: item.accessToken });
    } catch {
      // already invalidated, network error — proceed to delete locally
    }
    await prisma.plaidItem.delete({ where: { id: item.id } });

    res.json({ ok: true });
  }),
);

// ──────────────────────────────────────────────────────────────────────
// POST /api/plaid/items/:id/sync — incremental transaction sync.
// Uses /transactions/sync with a stored cursor for cheap deltas.
// Paginates until has_more=false.
// ──────────────────────────────────────────────────────────────────────
router.post(
  '/items/:id/sync',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const item = await prisma.plaidItem.findFirst({
      where: { id: req.params.id, userId },
      include: { accounts: true },
    });
    if (!item) throw notFound('Item not found');

    const result = await syncItem(item);
    res.json(result);
  }),
);

// ──────────────────────────────────────────────────────────────────────
// POST /api/plaid/sync — sync every active item for this user.
// ──────────────────────────────────────────────────────────────────────
router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const items = await prisma.plaidItem.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { accounts: true },
    });

    const totals = {
      added: 0, modified: 0, removed: 0, items: 0,
      importedExpenses: 0, importedIncomes: 0,
    };
    for (const item of items) {
      const r = await syncItem(item);
      totals.added += r.added;
      totals.modified += r.modified;
      totals.removed += r.removed;
      totals.importedExpenses += r.importedExpenses;
      totals.importedIncomes += r.importedIncomes;
      totals.items += 1;
    }
    res.json(totals);
  }),
);

// ──────────────────────────────────────────────────────────────────────
// GET /api/plaid/transactions — paginated bank transactions for this user.
// ──────────────────────────────────────────────────────────────────────
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  accountId: z.string().optional(),
  from: z.string().optional(), // ISO date
  to: z.string().optional(),
});

router.get(
  '/transactions',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { page, pageSize, accountId, from, to } = req.query as unknown as z.infer<typeof listQuerySchema>;

    const where: Prisma.BankTransactionWhereInput = { userId };
    if (accountId) where.accountId = accountId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [total, rows] = await Promise.all([
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      data: rows.map(serializeTx),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    });
  }),
);

export default router;

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

type ItemWithAccounts = Prisma.PlaidItemGetPayload<{ include: { accounts: true } }>;

async function syncItem(item: ItemWithAccounts) {
  // Map plaid_account_id → local PlaidAccount.id for FK joins.
  const accountIdByPlaidId = new Map(
    item.accounts.map((a) => [a.plaidAccountId, a.id]),
  );

  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: RemovedTransaction[] = [];

  let cursor: string | undefined = item.syncCursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const resp = await plaid().transactionsSync({
      access_token: item.accessToken,
      cursor,
    });
    added.push(...resp.data.added);
    modified.push(...resp.data.modified);
    removed.push(...resp.data.removed);
    hasMore = resp.data.has_more;
    cursor = resp.data.next_cursor;
  }

  // Refresh account balances. `/accounts/get` returns the latest balances
  // Plaid has on file (real-time pull from the bank if the bank supports it).
  const accountsRes = await plaid().accountsGet({ access_token: item.accessToken });
  const freshAccountByPlaidId = new Map(
    accountsRes.data.accounts.map((a) => [a.account_id, a]),
  );

  // Upsert added + modified, delete removed. Wrap in a single transaction.
  await prisma.$transaction(async (tx) => {
    for (const t of [...added, ...modified]) {
      const accountLocalId = accountIdByPlaidId.get(t.account_id);
      if (!accountLocalId) continue; // skip if account was removed mid-sync

      const data = {
        userId: item.userId,
        itemId: item.id,
        accountId: accountLocalId,
        amount: new Prisma.Decimal(t.amount),
        isoCurrencyCode: t.iso_currency_code ?? null,
        date: new Date(t.date),
        authorizedDate: t.authorized_date ? new Date(t.authorized_date) : null,
        name: t.name,
        merchantName: t.merchant_name ?? null,
        category: t.personal_finance_category?.primary ?? null,
        categoryDetailed: t.personal_finance_category?.detailed ?? null,
        pending: t.pending,
        paymentChannel: t.payment_channel ?? null,
      };

      await tx.bankTransaction.upsert({
        where: { plaidTransactionId: t.transaction_id },
        create: { ...data, plaidTransactionId: t.transaction_id },
        update: data,
      });
    }

    if (removed.length > 0) {
      await tx.bankTransaction.deleteMany({
        where: {
          plaidTransactionId: { in: removed.map((r) => r.transaction_id!).filter(Boolean) },
        },
      });
    }

    // Update PlaidAccount balances from the fresh /accounts/get pull.
    for (const account of item.accounts) {
      const fresh = freshAccountByPlaidId.get(account.plaidAccountId);
      if (!fresh) continue;
      await tx.plaidAccount.update({
        where: { id: account.id },
        data: {
          balanceCurrent: fresh.balances.current != null
            ? new Prisma.Decimal(fresh.balances.current) : null,
          balanceAvailable: fresh.balances.available != null
            ? new Prisma.Decimal(fresh.balances.available) : null,
          isoCurrencyCode: fresh.balances.iso_currency_code ?? account.isoCurrencyCode,
        },
      });
    }

    await tx.plaidItem.update({
      where: { id: item.id },
      data: { syncCursor: cursor, lastSyncedAt: new Date() },
    });
  });

  // Fan out into the user's Expense / Income ledger.
  const imported = await importToLedger(item.userId);

  return {
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    importedExpenses: imported.expenses,
    importedIncomes: imported.incomes,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Import logic — turn raw Plaid transactions into Expense / Income rows.
//
// Plaid amount convention: positive = money out, negative = money in.
// We skip:
//   - pending transactions (they'll re-appear as posted)
//   - transfers between the user's own accounts (would double-count)
//   - rows already linked (expenseId or incomeId set)
// ──────────────────────────────────────────────────────────────────────

// Plaid PRIMARY personal_finance_category → app category name.
const PRIMARY_TO_CATEGORY: Record<string, string> = {
  FOOD_AND_DRINK: 'Dining Out',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Housing',
  RENT_AND_UTILITIES: 'Utilities',
  TRANSPORTATION: 'Gas',
  MEDICAL: 'Medical',
  ENTERTAINMENT: 'Entertainment',
  TRAVEL: 'Entertainment',
  LOAN_PAYMENTS: 'Credit Card Payment',
  BANK_FEES: 'Other',
  PERSONAL_CARE: 'Other',
  GENERAL_SERVICES: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Other',
};

// Plaid DETAILED overrides — more specific where it matters.
const DETAILED_TO_CATEGORY: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries',
  FOOD_AND_DRINK_COFFEE: 'Coffee',
  FOOD_AND_DRINK_FAST_FOOD: 'Dining Out',
  FOOD_AND_DRINK_RESTAURANT: 'Dining Out',
  TRANSPORTATION_GAS: 'Gas',
  RENT_AND_UTILITIES_RENT: 'Housing',
  RENT_AND_UTILITIES_TELEPHONE: 'Phone',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'Internet',
  ENTERTAINMENT_TV_AND_MOVIES: 'Subscriptions',
  ENTERTAINMENT_VIDEO_AND_AUDIO_SUBSCRIPTIONS: 'Subscriptions',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'Credit Card Payment',
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: 'Student Loans',
  LOAN_PAYMENTS_CAR_PAYMENT: 'Car Payment',
};

const SKIP_PRIMARY = new Set(['TRANSFER_IN', 'TRANSFER_OUT']);

function pickCategoryName(primary: string | null, detailed: string | null): string {
  if (detailed && DETAILED_TO_CATEGORY[detailed]) return DETAILED_TO_CATEGORY[detailed];
  if (primary && PRIMARY_TO_CATEGORY[primary]) return PRIMARY_TO_CATEGORY[primary];
  return 'Other';
}

async function importToLedger(userId: string) {
  // Pull the unimported, posted, non-transfer rows.
  const pending = await prisma.bankTransaction.findMany({
    where: {
      userId,
      pending: false,
      expenseId: null,
      incomeId: null,
      OR: [
        { category: null },
        { category: { notIn: Array.from(SKIP_PRIMARY) } },
      ],
    },
    orderBy: { date: 'asc' },
  });

  if (pending.length === 0) return { expenses: 0, incomes: 0 };

  // Resolve all the category names we might need in one query.
  const wantedNames = new Set(['Other']);
  for (const t of pending) {
    if (t.amount.gt(0)) wantedNames.add(pickCategoryName(t.category, t.categoryDetailed));
  }
  const categories = await prisma.category.findMany({
    where: { isSystem: true, name: { in: Array.from(wantedNames) } },
  });
  const catByName = new Map(categories.map((c) => [c.name, c]));
  const fallbackCat = catByName.get('Other');
  if (!fallbackCat) {
    // System categories not seeded — bail loudly so we never silently lose
    // imports. This should never hit in normal use.
    throw new Error('System categories missing — run `npm run seed` in backend.');
  }

  let expenseCount = 0;
  let incomeCount = 0;

  for (const t of pending) {
    if (t.amount.isZero()) continue;

    if (t.amount.lt(0)) {
      // Income (Plaid: negative = money in)
      const income = await prisma.income.create({
        data: {
          userId,
          amount: t.amount.abs(),
          source: t.merchantName ?? t.name,
          receivedAt: t.date,
          note: `Imported from ${t.name}`,
        },
      });
      await prisma.bankTransaction.update({
        where: { id: t.id },
        data: { incomeId: income.id },
      });
      incomeCount += 1;
    } else {
      // Expense (Plaid: positive = money out)
      const categoryName = pickCategoryName(t.category, t.categoryDetailed);
      const category = catByName.get(categoryName) ?? fallbackCat;
      const expense = await prisma.expense.create({
        data: {
          userId,
          categoryId: category.id,
          amount: t.amount,
          date: t.date,
          note: t.merchantName ?? t.name,
          paymentMethod: 'BANK_TRANSFER',
          type: 'VARIABLE',
        },
      });
      await prisma.bankTransaction.update({
        where: { id: t.id },
        data: { expenseId: expense.id },
      });
      expenseCount += 1;
    }
  }

  return { expenses: expenseCount, incomes: incomeCount };
}

function serializeItem(item: Prisma.PlaidItemGetPayload<{ include: { accounts: true } }>) {
  return {
    id: item.id,
    institutionId: item.institutionId,
    institutionName: item.institutionName,
    status: item.status,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    accounts: item.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      officialName: a.officialName,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balanceCurrent: a.balanceCurrent?.toString() ?? null,
      balanceAvailable: a.balanceAvailable?.toString() ?? null,
      isoCurrencyCode: a.isoCurrencyCode,
    })),
  };
}

function serializeTx(tx: Prisma.BankTransactionGetPayload<{}>) {
  return {
    id: tx.id,
    accountId: tx.accountId,
    amount: tx.amount.toString(),
    isoCurrencyCode: tx.isoCurrencyCode,
    date: tx.date.toISOString(),
    name: tx.name,
    merchantName: tx.merchantName,
    category: tx.category,
    categoryDetailed: tx.categoryDetailed,
    pending: tx.pending,
    paymentChannel: tx.paymentChannel,
    expenseId: tx.expenseId,
    incomeId: tx.incomeId,
  };
}
