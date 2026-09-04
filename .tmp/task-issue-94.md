# タスク: ghcr.ioへ本体イメージをpublish (issue #94)

設計: `.tmp/design-issue-94.md`

- [x] ブランチ`feature/ghcr-image-94`を作成
- [x] `.github/workflows/publish.yml`を追加(matrixビルド + manifest merge)
- [x] `docker-compose.yml`の`image:`をghcrへ向け、`APP_IMAGE`で上書き可能にする
- [x] `.env.example`に`APP_IMAGE`を追加
- [x] `README.md`にpull手順・パッケージ公開設定・タグの説明を追記
- [x] `docker compose config -q`でcompose検証(既定値/上書き両方)
- [x] ワークフローYAMLの構文検証
- [x] CIの`docker`ジョブをarm64にも広げる(セルフレビューで追加)
- [x] 敵対的セルフレビュー(最大3ラウンド)
- [ ] `npm run typecheck` / `npm test` / `git status`確認
- [ ] PR作成 → CIグリーンを確認 → マージは確認を取る
