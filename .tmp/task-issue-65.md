# issue #65 タスクリスト

設計書: `.tmp/design-issue-65.md`

- [x] ブランチ `feature/separate-diff-page-issue-65` を作成
- [x] `router.ts`: `/repos/:owner/:name/pull/:number/diff` ルートを追加
- [x] `views/PullDiffView.vue` を新規作成(戻りリンク/タイトル/更新/DiffView)
- [x] `views/PullDetailView.vue`: diff関連を削除しリンクボタンに置き換え
- [x] `npm run format` / `npm run typecheck` / `npm run build -w web` / `npm run test -w server`(59件成功)
- [ ] コミットせず確認を依頼
