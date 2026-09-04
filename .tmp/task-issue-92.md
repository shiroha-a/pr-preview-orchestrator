# タスク: 不要イメージ削除の解放容量報告 (issue #92)

設計: `.tmp/design-issue-92.md`

- [x] ブランチ`feature/image-prune-freed-92`を作成
- [x] `df.ts`に`formatDockerSize`と`getImagesSizeBytes`を追加
- [x] `cleanup.ts`に`formatImagePruneSummary`を切り出し、前後差分を集計
- [x] テスト追加 + mutation検証
- [x] 敵対的セルフレビュー(最大3ラウンド)
- [x] `npm run typecheck` / `npm test` / `git status`確認
- [ ] PR作成 → CIグリーン確認 → マージは確認を取る
