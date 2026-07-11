# Dependabotアラート対応+依存関係の更新(2026-07-12)

## オープンなアラート

1. **GHSA-92pp-h63x-v22m(medium)**: `@hono/node-server` < 1.19.13
   serveStaticの連続スラッシュによるミドルウェア(認証)バイパス。
   - 直接依存は1.19.14で**対策済み**。脆弱なのは `prisma` → `@prisma/dev@0.24.3` が
     **完全固定ピン**している1.19.11(prisma CLIの開発用サーバー。常時起動はしないが
     ロックファイルに残る限りアラートは消えない)。
   - prisma最新(7.8.0)でも `@prisma/dev@0.24.3` 固定のため、rootの `overrides` で
     `@prisma/dev` 配下のみ `^1.19.13` へ強制する。
2. **GHSA-g7r4-m6w7-qqqr(low)**: `esbuild` >= 0.27.3, < 0.28.1
   Windows開発サーバーでの任意ファイル読み取り(development scope)。
   - root解決は0.28.1で**対策済み**。脆弱なのは `tsup@8.5.1`(最新)配下の0.27.7。
     tsupは `^0.27.0` 宣言のため、rootの `overrides` で `tsup` 配下のみ `^0.28.1` へ
     強制する。tsupはserverのビルドに使うため、`npm run build -w server` で動作確認する。

## 依存関係の更新(ユーザー追加要望)

`npm outdated` の結果、semver互換(wanted)の更新を適用する:
hono 4.12.29 / vite 8.1.4 / dompurify 3.4.12 / marked 18.0.6 / @types/node 22.20.1

メジャー更新は今回見送り(理由を記録):

- `@hono/node-server` 2.x: メジャー。serveStatic等のAPI互換を要確認のため別タスク。
- `typescript` 7.x: コンパイラ世代交代。vue-tsc/tsup/prismaの対応状況を見て別タスク。
- `@types/node` 26.x: 実行環境がNode 22のため22系に留める。

## 検証

- ロックファイルに脆弱バージョン(1.19.11 / 0.27.x)が残っていないこと
- 全テスト・型チェック(server/web)・web/serverの本番ビルドが通ること
