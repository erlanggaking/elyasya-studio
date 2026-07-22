-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CommissionReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "shopeeAccountId" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT NOT NULL DEFAULT '',
    "productItemId" TEXT NOT NULL DEFAULT '',
    "commissionAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "period" TEXT NOT NULL DEFAULT '',
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CommissionReport" ("commissionAmount", "id", "orderId", "period", "productItemId", "shopeeAccountId", "status", "syncedAt") SELECT "commissionAmount", "id", "orderId", "period", "productItemId", "shopeeAccountId", "status", "syncedAt" FROM "CommissionReport";
DROP TABLE "CommissionReport";
ALTER TABLE "new_CommissionReport" RENAME TO "CommissionReport";
CREATE INDEX "CommissionReport_ownerId_idx" ON "CommissionReport"("ownerId");
CREATE TABLE "new_Host" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "liveUsername" TEXT NOT NULL DEFAULT '',
    "liveShareLink" TEXT NOT NULL DEFAULT '',
    "liveUid" TEXT NOT NULL DEFAULT '',
    "autoPinEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPinSeconds" INTEGER NOT NULL DEFAULT 60,
    "autoPinMode" TEXT NOT NULL DEFAULT 'urut',
    "ownerId" TEXT,
    "studioId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Host_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Host_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Host" ("autoPinEnabled", "autoPinMode", "autoPinSeconds", "contact", "createdAt", "id", "liveShareLink", "liveUid", "liveUsername", "name", "note", "studioId") SELECT "autoPinEnabled", "autoPinMode", "autoPinSeconds", "contact", "createdAt", "id", "liveShareLink", "liveUid", "liveUsername", "name", "note", "studioId" FROM "Host";
DROP TABLE "Host";
ALTER TABLE "new_Host" RENAME TO "Host";
CREATE INDEX "Host_ownerId_idx" ON "Host"("ownerId");
CREATE TABLE "new_LiveCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL DEFAULT '',
    "shopeeSessionId" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedByDevice" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "LiveCommand_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LiveCommand" ("attempts", "claimedAt", "claimedByDevice", "createdAt", "finishedAt", "hostId", "id", "liveSessionId", "payload", "result", "shopeeSessionId", "status", "type") SELECT "attempts", "claimedAt", "claimedByDevice", "createdAt", "finishedAt", "hostId", "id", "liveSessionId", "payload", "result", "shopeeSessionId", "status", "type" FROM "LiveCommand";
DROP TABLE "LiveCommand";
ALTER TABLE "new_LiveCommand" RENAME TO "LiveCommand";
CREATE INDEX "LiveCommand_status_hostId_idx" ON "LiveCommand"("status", "hostId");
CREATE TABLE "new_Studio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Studio_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Studio" ("createdAt", "id", "location", "name") SELECT "createdAt", "id", "location", "name" FROM "Studio";
DROP TABLE "Studio";
ALTER TABLE "new_Studio" RENAME TO "Studio";
CREATE INDEX "Studio_ownerId_idx" ON "Studio"("ownerId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "passwordHash") SELECT "createdAt", "email", "id", "name", "passwordHash" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Akun pertama adalah pemilik instalasi dan menjadi superuser. Data lama
-- ditetapkan kepadanya agar tetap terlihat setelah tenant isolation aktif.
UPDATE "User"
SET "role" = 'superuser'
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);

UPDATE "Studio"
SET "ownerId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "ownerId" IS NULL;

UPDATE "Host"
SET "ownerId" = COALESCE(
  (SELECT "ownerId" FROM "Studio" WHERE "Studio"."id" = "Host"."studioId"),
  (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
)
WHERE "ownerId" IS NULL;

UPDATE "CommissionReport"
SET "ownerId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "ownerId" IS NULL;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
