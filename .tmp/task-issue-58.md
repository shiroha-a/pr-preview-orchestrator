# issue #58 タスクリスト

設計書: `.tmp/design-issue-58.md`

- [x] ブランチ `feature/restart-reset-options-issue-58` を作成
- [x] server: `queue.ts` の `JobPayload` に `resetTunnel` を追加
- [x] server: `service.ts` の `restartPreview` に `RestartOptions`(resetVolumes/resetTunnel)を実装
- [x] server: `worker.ts` の restart ジョブでオプションを伝搬
- [x] server: `routes/preview.ts` の `/:id/restart` でボディをパース
- [x] server: `routes/repositories.ts` のPR用 restart ルートでボディをパース
- [x] web: `client.ts` に `RestartPreviewOptions` を追加し restart API 2種に配線
- [x] web: `PreviewPanel.vue` の restart にオプションを通し、再起動ボタンでチェック値を送信
- [x] web: `PullDetailView.vue` / `BranchPreviews.vue` の restart アクション配線を更新
- [x] ツールチップ・コメントの更新(キャッシュ破棄は再ビルドのみ等)
- [x] `npm run format` / `npm run typecheck` / `npm run test -w server`(6ファイル49件成功)
- [ ] コミットせず確認を依頼
