-- CreateTable
CREATE TABLE "OneTimeCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OneTimeCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paySchedule" TEXT NOT NULL DEFAULT 'BIWEEKLY',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "planSince" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "currency", "email", "id", "name", "passwordHash", "paySchedule", "plan", "planSince", "updatedAt") SELECT "createdAt", "currency", "email", "id", "name", "passwordHash", "paySchedule", "plan", "planSince", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OneTimeCode_userId_kind_idx" ON "OneTimeCode"("userId", "kind");

-- CreateIndex
CREATE INDEX "OneTimeCode_expiresAt_idx" ON "OneTimeCode"("expiresAt");
