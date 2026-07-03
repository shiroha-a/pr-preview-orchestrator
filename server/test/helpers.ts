import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

export function testDbPath(): string {
  return `test.${process.pid}.db`;
}

export function testDbUrl(): string {
  return `file:./${testDbPath()}`;
}

export function basicAuthHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export function createTestPrisma(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: testDbUrl() });
  return new PrismaClient({ adapter });
}

export function runMigrateDeploy(): void {
  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDbUrl() },
    stdio: "pipe",
  });
}

export function setupTestDb(): void {
  try {
    rmSync(testDbPath());
  } catch {
    // ignore if not exists
  }
  runMigrateDeploy();
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = [
    "User",
    "PreviewEnvironment",
    "PullRequest",
    "SettingsProfile",
    "Repository",
    "Job",
  ];
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
  }
}

export function cleanupTestDb(): void {
  try {
    rmSync(testDbPath());
  } catch {
    // ignore
  }
}
