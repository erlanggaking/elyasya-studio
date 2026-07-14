-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Host" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "liveUsername" TEXT NOT NULL DEFAULT '',
    "studioId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Host_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Host" ("contact", "createdAt", "id", "name", "note", "studioId") SELECT "contact", "createdAt", "id", "name", "note", "studioId" FROM "Host";
DROP TABLE "Host";
ALTER TABLE "new_Host" RENAME TO "Host";
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
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopeeAccount_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ShopeeAccount" ("accessToken", "connectedAt", "hostId", "id", "refreshToken", "scope", "shopId", "shopName", "status", "tokenExpiresAt") SELECT "accessToken", "connectedAt", "hostId", "id", "refreshToken", "scope", "shopId", "shopName", "status", "tokenExpiresAt" FROM "ShopeeAccount";
DROP TABLE "ShopeeAccount";
ALTER TABLE "new_ShopeeAccount" RENAME TO "ShopeeAccount";
CREATE UNIQUE INDEX "ShopeeAccount_hostId_shopId_key" ON "ShopeeAccount"("hostId", "shopId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
