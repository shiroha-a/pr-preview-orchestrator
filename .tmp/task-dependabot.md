# Dependabot対応+依存更新 タスクリスト(2026-07-12)

- [x] 1. ブランチ `feature/dependabot-alerts` を作成
- [x] 2. root `package.json` に `overrides` を追加
      (`@prisma/dev` 配下の `@hono/node-server` を `^1.19.13` へ、
      `tsup` 配下の `esbuild` を `^0.28.1` へ)
- [x] 3. `@hono/node-server` を v2.0.8 へ更新(public API互換の性能向上リリース)
- [x] 4. `npm update` でsemver互換の更新を適用
      (hono 4.12.29 / vite 8.1.4 / dompurify 3.4.12 / marked 18.0.6 / @types/node 22.20.1)
- [x] 5. 検証: ロックファイルに脆弱バージョンなし・`npm audit` 0件・
      テスト82件パス・型チェックOK・web/serverビルドOK・実サーバー起動確認
      (health / SPA静的配信 / 連続スラッシュ / pushルート)
- [ ] 6. コミットせずユーザーへ確認

## 見送り(別タスク)

- `@hono/node-server` → 済(v2適用)
- `typescript` 5.9.3 → 7.x(コンパイラ世代交代。ツールチェーン対応を見て判断)
- `@types/node` 22.x → 26.x(実行環境がNode 22のため22系維持)
