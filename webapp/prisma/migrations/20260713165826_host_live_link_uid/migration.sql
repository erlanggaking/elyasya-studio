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
    "studioId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Host_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Host" ("contact", "createdAt", "id", "liveUsername", "name", "note", "studioId") SELECT "contact", "createdAt", "id", "liveUsername", "name", "note", "studioId" FROM "Host";
DROP TABLE "Host";
ALTER TABLE "new_Host" RENAME TO "Host";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
