import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    // isolate:false ではモジュールキャッシュがテストファイル間で共有されるため、
    // src/db/client(グローバルprisma)がどのファイルから最初にimportされても
    // テストDBを向くよう、テストファイル読み込み前に環境変数で固定する。
    env: {
      DATABASE_URL: "file:./test.vitest.db",
    },
  },
});
