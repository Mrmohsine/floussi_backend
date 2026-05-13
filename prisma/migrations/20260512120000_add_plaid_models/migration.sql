-- Plaid: bank linking. PlaidItem (institution link) → PlaidAccount (per-account
-- balances) → BankTransaction (raw synced ledger). Idempotent so it's safe to
-- re-apply on Neon.

-- ── PlaidItem ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PlaidItem" (
  "id"              TEXT PRIMARY KEY,
  "userId"          TEXT NOT NULL,
  "plaidItemId"     TEXT NOT NULL,
  "accessToken"     TEXT NOT NULL,
  "institutionId"   TEXT,
  "institutionName" TEXT,
  "syncCursor"      TEXT,
  "lastSyncedAt"    TIMESTAMP(3),
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaidItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlaidItem_plaidItemId_key" ON "PlaidItem"("plaidItemId");
CREATE INDEX        IF NOT EXISTS "PlaidItem_userId_idx"     ON "PlaidItem"("userId");

-- ── PlaidAccount ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PlaidAccount" (
  "id"               TEXT PRIMARY KEY,
  "itemId"           TEXT NOT NULL,
  "plaidAccountId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "officialName"     TEXT,
  "mask"             TEXT,
  "type"             TEXT NOT NULL,
  "subtype"          TEXT,
  "balanceCurrent"   DECIMAL(65,30),
  "balanceAvailable" DECIMAL(65,30),
  "isoCurrencyCode"  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaidAccount_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "PlaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlaidAccount_plaidAccountId_key" ON "PlaidAccount"("plaidAccountId");
CREATE INDEX        IF NOT EXISTS "PlaidAccount_itemId_idx"         ON "PlaidAccount"("itemId");

-- ── BankTransaction ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BankTransaction" (
  "id"                 TEXT PRIMARY KEY,
  "userId"             TEXT NOT NULL,
  "itemId"             TEXT NOT NULL,
  "accountId"          TEXT NOT NULL,
  "plaidTransactionId" TEXT NOT NULL,
  "amount"             DECIMAL(65,30) NOT NULL,
  "isoCurrencyCode"    TEXT,
  "date"               TIMESTAMP(3)   NOT NULL,
  "authorizedDate"     TIMESTAMP(3),
  "name"               TEXT NOT NULL,
  "merchantName"       TEXT,
  "category"           TEXT,
  "categoryDetailed"   TEXT,
  "pending"            BOOLEAN NOT NULL DEFAULT FALSE,
  "paymentChannel"     TEXT,
  "expenseId"          TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankTransaction_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "PlaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankTransaction_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "PlaidAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BankTransaction_plaidTransactionId_key" ON "BankTransaction"("plaidTransactionId");
CREATE INDEX        IF NOT EXISTS "BankTransaction_userId_date_idx"        ON "BankTransaction"("userId", "date");
CREATE INDEX        IF NOT EXISTS "BankTransaction_accountId_date_idx"     ON "BankTransaction"("accountId", "date");
CREATE INDEX        IF NOT EXISTS "BankTransaction_itemId_idx"             ON "BankTransaction"("itemId");
