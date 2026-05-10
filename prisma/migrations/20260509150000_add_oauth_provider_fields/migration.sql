-- Store external auth provider identity for OAuth sign-ins.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "providerSub" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_provider_providerSub_key"
  ON "User"("provider", "providerSub");

CREATE INDEX IF NOT EXISTS "User_providerSub_idx"
  ON "User"("providerSub");
