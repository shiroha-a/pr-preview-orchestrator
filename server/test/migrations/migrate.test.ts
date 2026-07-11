import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cleanupMigrateTestDb,
  createTestPrisma,
  migrateTestDbUrl,
  runMigrateDeploy,
  setupMigrateTestDb,
} from "../helpers";

const EXPECTED_TABLES = [
  "Job",
  "PreviewEnvironment",
  "PullRequest",
  "PushSubscription",
  "Repository",
  "SettingsProfile",
  "User",
  "WebPushKeys",
  "_prisma_migrations",
];

function countMigrationDirs(): number {
  return readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  ).length;
}

// 新規DBへの適用を試すため、共有テストDBではなく専用ファイルを使う(削除自由)。
beforeEach(() => {
  cleanupMigrateTestDb();
});

afterAll(() => {
  cleanupMigrateTestDb();
});

describe("prisma migrate deploy", () => {
  it("空のDBに全マイグレーションを適用できる", () => {
    expect(() => setupMigrateTestDb()).not.toThrow();
  });

  it("適用済みマイグレーション数がマイグレーションディレクトリ数と一致する", async () => {
    setupMigrateTestDb();
    const prisma = createTestPrisma(migrateTestDbUrl());

    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*) as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );

    expect(Number(rows[0]?.count)).toBe(countMigrationDirs());
    await prisma.$disconnect();
  });

  it("スキーマ定義どおりのテーブルが作成される", async () => {
    setupMigrateTestDb();
    const prisma = createTestPrisma(migrateTestDbUrl());

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );

    expect(rows.map((row) => row.name)).toEqual([...EXPECTED_TABLES].sort());
    await prisma.$disconnect();
  });

  it("2回実行してもエラーにならない（冪等性）", () => {
    setupMigrateTestDb();
    expect(() => runMigrateDeploy(migrateTestDbUrl())).not.toThrow();
  });

  it("UserテーブルのUNIQUE制約が有効", async () => {
    setupMigrateTestDb();
    const prisma = createTestPrisma(migrateTestDbUrl());

    await prisma.user.create({
      data: { username: "admin", passwordHash: "hash" },
    });

    await expect(
      prisma.user.create({
        data: { username: "admin", passwordHash: "other" },
      }),
    ).rejects.toThrow();

    await prisma.$disconnect();
  });
});
