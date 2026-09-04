# タスク: ディスク表示ラベルを実測パスにする (issue #97)

設計: `.tmp/design-issue-97.md`

- [x] ブランチ`feature/disk-label-97`を作成
- [x] `metrics.ts`に`resolveDiskUsage`を切り出し、`disk.path`を返す
- [x] `web/src/types.ts`の型を更新
- [x] `SystemMetrics.vue`のラベルを動的にする
- [x] テスト追加 + mutation検証
- [x] 実環境で通常時とフォールバック時の表示を確認
- [x] 敵対的セルフレビュー(最大3ラウンド)
- [x] `npm run typecheck`(server/web) / `npm test` / `git status`確認
- [ ] PR作成 → CIグリーン確認 → マージは確認を取る
