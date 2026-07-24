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
    "cookie" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopeeAccount_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ShopeeAccount" ("accessToken", "connectedAt", "connectorDeviceId", "hostId", "id", "refreshToken", "scope", "shopId", "shopName", "status", "tokenExpiresAt", "userId") SELECT "accessToken", "connectedAt", "connectorDeviceId", "hostId", "id", "refreshToken", "scope", "shopId", "shopName", "status", "tokenExpiresAt", "userId" FROM "ShopeeAccount";
DROP TABLE "ShopeeAccount";
ALTER TABLE "new_ShopeeAccount" RENAME TO "ShopeeAccount";
CREATE UNIQUE INDEX "ShopeeAccount_hostId_shopId_key" ON "ShopeeAccount"("hostId", "shopId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
