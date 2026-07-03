-- CreateTable
CREATE TABLE "SettingsProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "composePath" TEXT,
    "webService" TEXT,
    "internalPort" INTEGER,
    "fileRewrites" TEXT,
    "overlayFiles" TEXT,
    "resetVolumes" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SettingsProfile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PreviewEnvironment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'pr',
    "pullRequestId" TEXT,
    "repositoryId" TEXT,
    "branchRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "composeProject" TEXT NOT NULL,
    "url" TEXT,
    "hostPort" INTEGER,
    "commitSha" TEXT,
    "logs" TEXT NOT NULL DEFAULT '',
    "profileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PreviewEnvironment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreviewEnvironment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreviewEnvironment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "SettingsProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PreviewEnvironment" ("branchRef", "commitSha", "composeProject", "createdAt", "hostPort", "id", "kind", "logs", "pullRequestId", "repositoryId", "status", "updatedAt", "url") SELECT "branchRef", "commitSha", "composeProject", "createdAt", "hostPort", "id", "kind", "logs", "pullRequestId", "repositoryId", "status", "updatedAt", "url" FROM "PreviewEnvironment";
DROP TABLE "PreviewEnvironment";
ALTER TABLE "new_PreviewEnvironment" RENAME TO "PreviewEnvironment";
CREATE UNIQUE INDEX "PreviewEnvironment_pullRequestId_key" ON "PreviewEnvironment"("pullRequestId");
CREATE UNIQUE INDEX "PreviewEnvironment_repositoryId_branchRef_key" ON "PreviewEnvironment"("repositoryId", "branchRef");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SettingsProfile_repositoryId_name_key" ON "SettingsProfile"("repositoryId", "name");
