# タスク: issue #17 / #18 / #20

## issue #17: コミットハッシュ表示(UIのみ)
- [x] `PreviewPanel.vue`: prop `prHeadSha` 追加、`commitSha` ref 保持、比較表示追加
- [x] `PullDetailView.vue`: `PreviewPanel`へ`pr-head-sha`を渡す

## issue #18: Draft PR区別
- [x] `schema.prisma`: `PullRequest.draft Boolean @default(false)` 追加
- [x] マイグレーション作成(`20260629125849_add_pr_draft`) + `prisma generate`
- [x] `github/pulls.ts`: `draft`の取得・マッピング追加
- [x] `web/src/types.ts`: `PullRequestDTO.draft` 追加
- [x] `DraftBadge.vue` 新規作成
- [x] `RepoPullsView.vue` / `PullDetailView.vue` にバッジ表示

## issue #20: ビルドキャッシュ破棄
- [x] `jobs/queue.ts`: `JobPayload.noCache` 追加
- [x] `jobs/worker.ts`: buildジョブで`noCache`を渡す
- [x] `preview/service.ts`: `buildPreview(id, noCache)` 2段階ビルド対応
- [x] `routes/repositories.ts`: POST preview で body の`noCache`解析
- [x] `web/src/api/client.ts`: `startPreview`に`noCache`オプション
- [x] `PreviewPanel.vue`: 「キャッシュ破棄して再ビルド」ボタン(PR個別)
- [x] `preview/service.ts`: `pruneBuilderCache()`(`docker builder prune -f`)
- [x] `routes/preview.ts`: POST `/preview/builder-prune`
- [x] `web/src/api/client.ts`: `pruneBuilderCache`
- [x] `SystemMetrics.vue`: 「ビルドキャッシュを削除」ボタン(ホスト全体)

## 仕上げ
- [x] `npm run typecheck`(server + web)通過
- [x] `npm run format`(範囲外のPR #19整形差分は除外)
- [ ] コミット(確認後)
