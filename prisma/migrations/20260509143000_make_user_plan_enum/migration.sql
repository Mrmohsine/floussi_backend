-- Convert User.plan from free-form text to a PostgreSQL enum.
-- Existing unexpected values are normalized to FREE before the cast.

DO $$
BEGIN
  CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'PREMIUM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ALTER COLUMN "plan" DROP DEFAULT;

UPDATE "User"
SET "plan" = 'FREE'
WHERE "plan" IS NULL
   OR "plan" NOT IN ('FREE', 'PRO', 'PREMIUM');

ALTER TABLE "User"
ALTER COLUMN "plan" TYPE "Plan"
USING "plan"::"Plan";

ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE';
