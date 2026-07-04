# モバイル横はみ出し修正 タスクリスト

設計書: `.tmp/design-mobile-overflow.md`

- [x] ブランチ `feature/mobile-overflow-fixes` を作成
- [x] `DashboardView.vue`: グリッドアイテム(BaseCard/RouterLink)に `min-w-0` を付与
- [x] `DashboardView.vue`: プレビューURLを `break-all` で折り返し、アイコンに `shrink-0`
- [x] `MarkdownView.vue`: `:deep(table)` にGitHub方式のはみ出し対策CSSを追加
- [x] `npm run format` / `npm run typecheck` / `npm run build -w web`(すべて成功)
- [x] アップロード画像(IMG_4271.png / IMG_4272.png)を削除
- [ ] コミットせず確認を依頼
