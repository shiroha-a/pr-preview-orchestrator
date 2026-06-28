-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Repository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installationId" INTEGER,
    "composePath" TEXT NOT NULL DEFAULT 'docker-compose.yml',
    "webService" TEXT,
    "internalPort" INTEGER,
    "fileRewrites" TEXT,
    "resetVolumes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Repository" ("composePath", "createdAt", "id", "installationId", "internalPort", "name", "owner", "updatedAt", "webService") SELECT "composePath", "createdAt", "id", "installationId", "internalPort", "name", "owner", "updatedAt", "webService" FROM "Repository";
DROP TABLE "Repository";
ALTER TABLE "new_Repository" RENAME TO "Repository";
CREATE UNIQUE INDEX "Repository_owner_name_key" ON "Repository"("owner", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
