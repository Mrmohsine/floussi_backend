-- Track when a BankTransaction has been imported into the user's Income
-- ledger so subsequent syncs don't create duplicates.

ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "incomeId" TEXT;
