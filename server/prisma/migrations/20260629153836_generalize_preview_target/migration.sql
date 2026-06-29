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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PreviewEnvironment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreviewEnvironment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PreviewEnvironment" ("commitSha", "composeProject", "createdAt", "hostPort", "id", "logs", "pullRequestId", "status", "updatedAt", "url") SELECT "commitSha", "composeProject", "createdAt", "hostPort", "id", "logs", "pullRequestId", "status", "updatedAt", "url" FROM "PreviewEnvironment";
DROP TABLE "PreviewEnvironment";
ALTER TABLE "new_PreviewEnvironment" RENAME TO "PreviewEnvironment";
CREATE UNIQUE INDEX "PreviewEnvironment_pullRequestId_key" ON "PreviewEnvironment"("pullRequestId");
CREATE UNIQUE INDEX "PreviewEnvironment_repositoryId_branchRef_key" ON "PreviewEnvironment"("repositoryId", "branchRef");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
