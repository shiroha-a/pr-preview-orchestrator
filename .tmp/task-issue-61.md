# issue #61 タスクリスト

設計書: `.tmp/design-issue-61.md`

- [x] ブランチ `feature/volume-import-export-issue-61` を作成
- [x] server: `env.ts` / `.env.example` に `PREVIEW_VOLUME_HELPER_IMAGE` を追加
- [x] server: `preview/uploads.ts`(分割アップロードセッション管理)を新規作成
- [x] server: `preview/volumes.ts`(一覧/所属検証/エクスポート/インポート)を新規作成
- [x] server: `jobs/queue.ts` に `volume-import` ジョブ種別と payload を追加
- [x] server: `jobs/worker.ts` で `volume-import` をディスパッチ
- [x] server: `routes/preview.ts` にボリュームAPI6本を追加
- [x] web: `api/client.ts` に一覧/エクスポートURL/分割アップロードを追加
- [x] web: `components/VolumesModal.vue` を新規作成
- [x] web: `PreviewPanel.vue` に「ボリューム」ボタンとモーダルを配線
- [x] test: `server/test/preview/uploads.test.ts` を追加(10件)
- [x] `npm run format` / `npm run typecheck` / `npm run test -w server`(7ファイル59件成功)/ `npm run build -w web`
- [ ] コミットせず確認を依頼
