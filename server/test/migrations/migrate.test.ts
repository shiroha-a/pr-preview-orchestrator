import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cleanupTestDb,
  createTestPrisma,
  runMigrateDeploy,
  setupTestDb,
} from "../helpers";

const EXPECTED_TABLES = [
  "Job",
  "PreviewEnvironment",
  "PullRequest",
  "Repository",
  "User",
  "_prisma_migrations",
];

function countMigrationDirs(): number {
  return readdirSync(join(process.cwd(), "prisma/migrations"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  ).length;
}

beforeEach(() => {
  cleanupTestDb();
});

afterAll(() => {
  cleanupTestDb();
});

describe("prisma migrate deploy", () => {
  it("空のDBに全マイグレーションを適用できる", () => {
    expect(() => setupTestDb()).not.toThrow();
  });

  it("適用済みマイグレーション数がマイグレーションディレクトリ数と一致する", async () => {
    setupTestDb();
    const prisma = createTestPrisma();

    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*) as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );

    expect(Number(rows[0]?.count)).toBe(countMigrationDirs());
    await prisma.$disconnect();
  });

  it("スキーマ定義どおりのテーブルが作成される", async () => {
    setupTestDb();
    const prisma = createTestPrisma();

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );

    expect(rows.map((row) => row.name)).toEqual([...EXPECTED_TABLES].sort());
    await prisma.$disconnect();
  });

  it("2回実行してもエラーにならない（冪等性）", () => {
    setupTestDb();
    expect(() => runMigrateDeploy()).not.toThrow();
  });

  it("UserテーブルのUNIQUE制約が有効", async () => {
    setupTestDb();
    const prisma = createTestPrisma();

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
