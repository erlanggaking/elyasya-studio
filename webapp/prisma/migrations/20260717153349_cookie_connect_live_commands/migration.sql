-- CreateTable
CREATE TABLE "LiveCommand" (
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
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ShopeeLiveEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "urlTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL DEFAULT '',
    "sampleBody" TEXT NOT NULL DEFAULT '{}',
    "learnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopeeAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "shopName" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "tokenExpiresAt" DATETIME,
    "scope" TEXT NOT NULL DEFAULT 'livestream',
    "connectorDeviceId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopeeAccount_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ShopeeAccount" ("accessToken", "connectedAt", "hostId", "id", "refreshToken", "scope", "shopId", "shopName", "status", "tokenExpiresAt", "userId") SELECT "accessToken", "connectedAt", "hostId", "id", "refreshToken", "scope", "shopId", "shopName", "status", "tokenExpiresAt", "userId" FROM "ShopeeAccount";
DROP TABLE "ShopeeAccount";
ALTER TABLE "new_ShopeeAccount" RENAME TO "ShopeeAccount";
CREATE UNIQUE INDEX "ShopeeAccount_hostId_shopId_key" ON "ShopeeAccount"("hostId", "shopId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LiveCommand_status_hostId_idx" ON "LiveCommand"("status", "hostId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopeeLiveEndpoint_action_key" ON "ShopeeLiveEndpoint"("action");
