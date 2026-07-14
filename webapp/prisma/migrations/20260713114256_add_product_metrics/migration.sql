-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL DEFAULT 0,
    "commissionRate" REAL NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "sold30d" INTEGER NOT NULL DEFAULT 0,
    "rating" REAL NOT NULL DEFAULT 0,
    "trend" REAL NOT NULL DEFAULT 0,
    "revenue" REAL NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'extension',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "rawPayload" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "new_Product" ("commissionRate", "firstSeenAt", "id", "imageUrl", "itemId", "name", "price", "rawPayload", "revenue", "shopId", "sold", "source", "updatedAt") SELECT "commissionRate", "firstSeenAt", "id", "imageUrl", "itemId", "name", "price", "rawPayload", "revenue", "shopId", "sold", "source", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_itemId_shopId_key" ON "Product"("itemId", "shopId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
