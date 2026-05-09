-- Convert categories from per-user ownership to a shared catalog plus a
-- user/category pivot table. Duplicate category names are consolidated by
-- normalized name; system categories win when a duplicate exists.

CREATE TABLE IF NOT EXISTS "UserCategory" (
  "userId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserCategory_pkey" PRIMARY KEY ("userId", "categoryId"),
  CONSTRAINT "UserCategory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserCategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserCategory_userId_idx" ON "UserCategory"("userId");
CREATE INDEX IF NOT EXISTS "UserCategory_categoryId_idx" ON "UserCategory"("categoryId");

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "normalizedName" TEXT;

UPDATE "Category"
SET "normalizedName" = lower(trim("name"))
WHERE "normalizedName" IS NULL;

-- Link existing user-owned categories to their canonical shared category.
WITH ranked AS (
  SELECT
    "id",
    "userId",
    lower(trim("name")) AS normalized_name,
    row_number() OVER (
      PARTITION BY lower(trim("name"))
      ORDER BY "isSystem" DESC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Category"
),
canonical AS (
  SELECT "id" AS canonical_id, normalized_name
  FROM ranked
  WHERE rn = 1
)
INSERT INTO "UserCategory" ("userId", "categoryId")
SELECT r."userId", c.canonical_id
FROM ranked r
JOIN canonical c ON c.normalized_name = r.normalized_name
WHERE r."userId" IS NOT NULL
ON CONFLICT ("userId", "categoryId") DO NOTHING;

-- Re-point existing data from duplicate category rows to the canonical row.
WITH ranked AS (
  SELECT
    "id",
    lower(trim("name")) AS normalized_name,
    row_number() OVER (
      PARTITION BY lower(trim("name"))
      ORDER BY "isSystem" DESC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Category"
),
canonical AS (
  SELECT "id" AS canonical_id, normalized_name
  FROM ranked
  WHERE rn = 1
)
UPDATE "Expense" e
SET "categoryId" = c.canonical_id
FROM ranked r
JOIN canonical c ON c.normalized_name = r.normalized_name
WHERE e."categoryId" = r."id"
  AND r.rn > 1;

WITH ranked AS (
  SELECT
    "id",
    lower(trim("name")) AS normalized_name,
    row_number() OVER (
      PARTITION BY lower(trim("name"))
      ORDER BY "isSystem" DESC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Category"
),
canonical AS (
  SELECT "id" AS canonical_id, normalized_name
  FROM ranked
  WHERE rn = 1
)
UPDATE "RecurringBill" b
SET "categoryId" = c.canonical_id
FROM ranked r
JOIN canonical c ON c.normalized_name = r.normalized_name
WHERE b."categoryId" = r."id"
  AND r.rn > 1;

-- Remove duplicate category rows after all references have been moved.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY lower(trim("name"))
      ORDER BY "isSystem" DESC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Category"
)
DELETE FROM "Category" c
USING ranked r
WHERE c."id" = r."id"
  AND r.rn > 1;

UPDATE "Category"
SET "normalizedName" = lower(trim("name"));

ALTER TABLE "Category" ALTER COLUMN "normalizedName" SET NOT NULL;

DROP INDEX IF EXISTS "Category_userId_name_key";
DROP INDEX IF EXISTS "Category_userId_idx";
ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS "Category_userId_fkey";
ALTER TABLE "Category" DROP COLUMN IF EXISTS "userId";

CREATE UNIQUE INDEX IF NOT EXISTS "Category_normalizedName_key"
  ON "Category"("normalizedName");
