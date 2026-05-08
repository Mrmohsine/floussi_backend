-- Run this once on your production Supabase Postgres database.
-- It adds the OAuth fields the new /auth/oauth/{google,apple} endpoints need.
--
-- How to run:
--   1. Open https://supabase.com/dashboard → your project → SQL Editor
--   2. Paste the statements below, click "Run"
--   3. Confirm with the verification query at the bottom
--
-- Or via psql with your Supabase DIRECT_URL:
--   psql "$DIRECT_URL" -f backend/prisma/OAUTH_MIGRATION.sql

BEGIN;

-- 1. passwordHash becomes nullable so OAuth users (no password) can exist.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- 2. Track which provider signed the user up.
-- "provider"    = 'google' | 'apple' | NULL (NULL = email/password user)
-- "providerSub" = the stable subject ID from the provider's id_token.
ALTER TABLE "User" ADD COLUMN "provider" TEXT;
ALTER TABLE "User" ADD COLUMN "providerSub" TEXT;

-- 3. Compound unique constraint — same email could in theory link to two
-- providers in the future, but a single (provider, providerSub) pair must
-- map to exactly one user. NULL pairs are allowed (email/password users).
CREATE UNIQUE INDEX "User_provider_providerSub_key"
  ON "User"("provider", "providerSub");

COMMIT;

-- Verify (should return 3 rows: passwordHash, provider, providerSub).
-- SELECT column_name, is_nullable, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'User'
--     AND column_name IN ('passwordHash','provider','providerSub');
