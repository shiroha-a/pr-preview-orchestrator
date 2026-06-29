import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Fall back to a local SQLite file so migrations work without a .env file.
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
