import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Dependencies (including better-sqlite3 native bindings and the Prisma
  // runtime) stay external and are resolved from node_modules at runtime.
});
