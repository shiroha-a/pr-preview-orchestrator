import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

function dbUrl(): string {
  return `file:./test.${process.pid}.db`;
}

export function basicAuthHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export function createTestPrisma(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: dbUrl() });
  return new PrismaClient({ adapter });
}

export function setupTestDb(): void {
  try {
    rmSync(`test.${process.pid}.db`);
  } catch {
    // ignore if not exists
  }
  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl() },
    stdio: "ignore",
  });
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = ["User", "PreviewEnvironment", "PullRequest", "Repository", "Job"];
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
  }
}

export function cleanupTestDb(): void {
  try {
    rmSync(`test.${process.pid}.db`);
  } catch {
    // ignore
  }
}
