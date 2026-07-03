# issue #52 タスクリスト

## サーバー

- [x] 1. Prismaスキーマ: SettingsProfileモデル + PreviewEnvironment.profileId 追加、マイグレーション生成
- [x] 2. `preview/settings.ts` 新規: parseComposePaths / composeFileArgs / resolveSettings
- [x] 3. `preview/service.ts`: profileを含むロード、EffectiveSettings適用、compose引数の複数-f化
- [x] 4. `preview/logstream.ts`: 複数composeファイル対応
- [x] 5. `routes/repositories.ts`: settings PUTのprofiles同期、GETでprofiles返却、preview起動APIのprofileId対応
- [x] 6. テスト: settings.test.ts新規、migrate.test.ts / helpers.ts 更新(全36件パス)

## Web

- [x] 7. types.ts / api/client.ts: SettingsProfileDTO、profiles、profileId追加
- [x] 8. RewriteRulesEditor.vue / OverlayFilesEditor.vue 共通コンポーネント化
- [x] 9. RepoSettingsView.vue: composePathのtextarea化、プロファイル編集UI、エクスポート/インポート対応
- [x] 10. PreviewPanel.vue: プロファイル選択・表示、起動オプションにprofileId
- [x] 11. PullDetailView.vue / BranchPreviews.vue: プロファイル一覧の取得と受け渡し

## 仕上げ

- [x] 12. README更新(複数composeファイル・プロファイル)
- [x] 13. フォーマット(prettier)・typecheck・テスト実行(server 36件パス、typecheck両方OK)
