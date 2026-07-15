-- AlterTable
ALTER TABLE "Repository" ADD COLUMN "buildMode" TEXT;

-- AlterTable
ALTER TABLE "SettingsProfile" ADD COLUMN "buildMode" TEXT;

-- CreateTable
CREATE TABLE "BuildAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildAgent_name_key" ON "BuildAgent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BuildAgent_tokenHash_key" ON "BuildAgent"("tokenHash");
