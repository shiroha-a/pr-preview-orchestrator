import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import { env } from "../env";

/**
 * Prisma 7 requires a driver adapter. We use better-sqlite3 for a local,
 * self-contained SQLite database. The client is cached on globalThis so that
 * dev watch reloads do not exhaust connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
