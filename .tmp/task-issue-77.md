# issue #77 タスクリスト

- [x] 1. ブランチ `feature/build-finish-notifications` を作成
- [x] 2. `web-push` / `@types/web-push` を server ワークスペースへ追加
- [x] 3. Prisma: `WebPushKeys` / `PushSubscription` モデル追加+マイグレーション
      (`20260711170900_add_web_push`)
- [x] 4. `server/src/push/service.ts`(キー自動生成・購読管理・全購読送信)
- [x] 5. `server/src/routes/push.ts` + `app.ts` へマウント
- [x] 6. `buildPreview` に成功/失敗時の通知送信を追加(`BuildTarget.appPath`)
- [x] 7. `web/public/sw.js`(push受信・クリックで該当ページへ)
- [x] 8. `web/src/notifications.ts`(通知音+プッシュ購読ヘルパー)
- [x] 9. `web/src/api/client.ts` にpush APIを追加
- [x] 10. `SettingsView.vue` に「通知(ビルド完了)」カード(音/プッシュのトグル+テスト)
- [x] 11. `PreviewPanel.vue` でビルド完了遷移時に通知音
- [x] 12. テスト `server/test/routes/push.test.ts`(8件)+ migrate.test.ts更新
- [x] 13. README更新(通知セクション)
- [x] 14. テスト82件パス・型チェック(server/web)・webビルド・フォーマッタ・
      実サーバーでのcurl検証(キー自動生成の永続・subscribe/unsubscribe/test)
- [ ] 15. コミットせずユーザーへ確認
