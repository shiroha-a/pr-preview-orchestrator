-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "state" TEXT NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "authorLogin" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "htmlUrl" TEXT,
    "prUpdatedAt" DATETIME NOT NULL,
    "diffCache" TEXT,
    "commentsCache" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PullRequest" ("authorLogin", "baseRef", "body", "commentsCache", "createdAt", "diffCache", "headRef", "headSha", "htmlUrl", "id", "number", "prUpdatedAt", "repositoryId", "state", "title", "updatedAt") SELECT "authorLogin", "baseRef", "body", "commentsCache", "createdAt", "diffCache", "headRef", "headSha", "htmlUrl", "id", "number", "prUpdatedAt", "repositoryId", "state", "title", "updatedAt" FROM "PullRequest";
DROP TABLE "PullRequest";
ALTER TABLE "new_PullRequest" RENAME TO "PullRequest";
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_key" ON "PullRequest"("repositoryId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
