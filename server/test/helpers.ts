import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

// vitestは maxWorkers:1 / isolate:false で全テストファイルが1プロセスを共有する。
// 共有テストDBは実行中に削除しない(接続済みのbetter-sqlite3ハンドルが削除済み
// inodeを掴んだままになり、以降のテストが空振りするため)。vitest.config.ts の
// env.DATABASE_URL と同じパスを指すこと。

/** Shared test database used by route tests (never deleted mid-run). */
export function testDbPath(): string {
  return "test.vitest.db";
}

export function testDbUrl(): string {
  return `file:./${testDbPath()}`;
}

/**
 * Dedicated database for fresh-migration tests (migrate.test.ts), which need to
 * delete and recreate the file freely without breaking connections cached by
 * other test files.
 */
export function migrateTestDbPath(): string {
  return "test.migrate.db";
}

export function migrateTestDbUrl(): string {
  return `file:./${migrateTestDbPath()}`;
}

export function basicAuthHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export function createTestPrisma(url: string = testDbUrl()): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

export function runMigrateDeploy(url: string = testDbUrl()): void {
  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/**
 * Bring the shared test database up to date without deleting it. Data cleanup
 * is done per-test via truncateAll.
 */
export function prepareSharedTestDb(): void {
  runMigrateDeploy();
}

/** Recreate the migration-test database from scratch. */
export function setupMigrateTestDb(): void {
  cleanupMigrateTestDb();
  runMigrateDeploy(migrateTestDbUrl());
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

export function cleanupMigrateTestDb(): void {
  try {
    rmSync(migrateTestDbPath());
  } catch {
    // ignore
  }
}
