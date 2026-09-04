# タスク: 本体Docker起動時のログインループ対応

設計: `.tmp/design-docker-env-dollar.md`

- [x] ブランチ`feature/docker-env-dollar-escape`を作成
- [x] `.env.example`: 秘密情報の項目をシングルクォート表記にし、`$`の扱いを注記
- [x] `README.md`: 「Dockerで動かす」の注意点に`$`の扱いを追記
- [x] `server/src/auth/middleware.ts`: 認証失敗時の警告ログを追加(パスワードは出力しない)
- [x] `server/test/auth/middleware.test.ts`: 警告ログのテストを追加(mutation検証込み)
- [x] `npm run typecheck` / `npm test` / `npm run format`
- [x] 実環境(コンテナ)で`$`入りパスワードが通ることを確認
- [ ] コミット内容を提示して確認を取る
