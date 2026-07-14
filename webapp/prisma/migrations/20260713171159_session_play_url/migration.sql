-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LiveSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopeeSessionId" TEXT NOT NULL DEFAULT '',
    "hostId" TEXT NOT NULL,
    "studioId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "title" TEXT NOT NULL DEFAULT '',
    "pushUrl" TEXT NOT NULL DEFAULT '',
    "pushKey" TEXT NOT NULL DEFAULT '',
    "shareUrl" TEXT NOT NULL DEFAULT '',
    "playUrl" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveSession_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LiveSession" ("createdAt", "endedAt", "hostId", "id", "pushKey", "pushUrl", "shareUrl", "shopeeSessionId", "startedAt", "status", "studioId", "title") SELECT "createdAt", "endedAt", "hostId", "id", "pushKey", "pushUrl", "shareUrl", "shopeeSessionId", "startedAt", "status", "studioId", "title" FROM "LiveSession";
DROP TABLE "LiveSession";
ALTER TABLE "new_LiveSession" RENAME TO "LiveSession";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
