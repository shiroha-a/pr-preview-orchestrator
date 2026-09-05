# issue #101 タスク

- [x] `Dockerfile` のaptインストールに `docker-buildx-plugin` を追加
- [x] `.github/workflows/ci.yml` の同梱ツール検証に `docker buildx version` を追加
- [x] ミューテーション検証(プラグインを外すと検証ステップが `docker: unknown command: docker buildx` で終了コード1)
- [x] 実症状の再現と解消の確認
      - buildx無し: issueと同一の警告 + `RUN --mount` が `the --mount option requires BuildKit` で失敗
      - buildx有り: 警告なし・BuildKit専用機能を含むビルドが成功(exit 0)
- [x] BuildKitビルドでも `com.docker.compose.project` ラベルが付くことを確認
      (issue #67/#92 の孤児イメージ削除が壊れないこと)
- [x] 既存テストスイート(typecheck + vitest 100件)がグリーン
- [ ] PR作成 / CIグリーン確認
