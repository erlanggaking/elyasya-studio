-- CreateTable
CREATE TABLE "CollectionFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CollectionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "folderId" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "CollectionEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionEntry_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "CollectionFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CollectionEntry" ("addedAt", "addedBy", "id", "productId", "tags") SELECT "addedAt", "addedBy", "id", "productId", "tags" FROM "CollectionEntry";
DROP TABLE "CollectionEntry";
ALTER TABLE "new_CollectionEntry" RENAME TO "CollectionEntry";
CREATE UNIQUE INDEX "CollectionEntry_productId_key" ON "CollectionEntry"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CollectionFolder_name_key" ON "CollectionFolder"("name");
