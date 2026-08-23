/*
  Warnings:

  - You are about to drop the column `hostPort` on the `PreviewEnvironment` table. All the data in the column will be lost.

*/
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
    "commitSha" TEXT,
    "logs" TEXT NOT NULL DEFAULT '',
    "profileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PreviewEnvironment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreviewEnvironment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreviewEnvironment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "SettingsProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PreviewEnvironment" ("branchRef", "commitSha", "composeProject", "createdAt", "id", "kind", "logs", "profileId", "pullRequestId", "repositoryId", "status", "updatedAt", "url") SELECT "branchRef", "commitSha", "composeProject", "createdAt", "id", "kind", "logs", "profileId", "pullRequestId", "repositoryId", "status", "updatedAt", "url" FROM "PreviewEnvironment";
DROP TABLE "PreviewEnvironment";
ALTER TABLE "new_PreviewEnvironment" RENAME TO "PreviewEnvironment";
CREATE UNIQUE INDEX "PreviewEnvironment_pullRequestId_key" ON "PreviewEnvironment"("pullRequestId");
CREATE UNIQUE INDEX "PreviewEnvironment_repositoryId_branchRef_key" ON "PreviewEnvironment"("repositoryId", "branchRef");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
