-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "studioId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Host_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Host" ("contact", "createdAt", "id", "liveShareLink", "liveUid", "liveUsername", "name", "note", "studioId") SELECT "contact", "createdAt", "id", "liveShareLink", "liveUid", "liveUsername", "name", "note", "studioId" FROM "Host";
DROP TABLE "Host";
ALTER TABLE "new_Host" RENAME TO "Host";
CREATE TABLE "new_LiveSessionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveSessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemNo" INTEGER NOT NULL DEFAULT 0,
    "isShowing" BOOLEAN NOT NULL DEFAULT false,
    "soldItems" INTEGER NOT NULL DEFAULT 0,
    "itemClicks" INTEGER NOT NULL DEFAULT 0,
    "atc" INTEGER NOT NULL DEFAULT 0,
    "pushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceAssignmentId" TEXT,
    CONSTRAINT "LiveSessionItem_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveSessionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveSessionItem_sourceAssignmentId_fkey" FOREIGN KEY ("sourceAssignmentId") REFERENCES "Assignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LiveSessionItem" ("id", "isShowing", "itemNo", "liveSessionId", "productId", "pushedAt", "sourceAssignmentId") SELECT "id", "isShowing", "itemNo", "liveSessionId", "productId", "pushedAt", "sourceAssignmentId" FROM "LiveSessionItem";
DROP TABLE "LiveSessionItem";
ALTER TABLE "new_LiveSessionItem" RENAME TO "LiveSessionItem";
CREATE UNIQUE INDEX "LiveSessionItem_liveSessionId_productId_key" ON "LiveSessionItem"("liveSessionId", "productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
