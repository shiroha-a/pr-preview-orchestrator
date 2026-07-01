# 設計: issue #41(初期化して再起動)/ #42(設定維持で再ビルド)

`feat/issue-41-reset-volumes-restart`ブランチ。Misskey等でトンネルURLがDBに焼き込まれる問題への2つの対処。

- #41「volumeを破棄して再起動」= 初期化して再起動: ボリューム(DB等)を破棄して作り直す。
- #42「トンネルを維持して再ビルド」= 設定(トンネル/URL)を維持したまま修正→再起動: URLを変えずに再ビルドし、DB再生成を不要にする。

## 実装(#20 noCache と同じビルドオプション方式)
- `buildPreview(previewId, opts: { noCache?; resetVolumes?; keepTunnel? })` に一般化。
  - `resetVolumes`(#41): `repo.resetVolumes || opts.resetVolumes` のとき `docker compose down -v`。
  - `keepTunnel`(#42): `isTunnelAlive && preview.url` があれば既存トンネルURLを流用し、
    `startTunnel`を呼ばない → URL維持 → rewriteも同一URLで適用 → DB再生成不要。
- `JobPayload` に `resetVolumes?` / `keepTunnel?` を追加。worker から opts で渡す。
- ルート: `parseBuildOptions(c)` で body の `{ noCache, resetVolumes, keepTunnel }` を解析。
  PR起動 / ブランチ起動の両ルートで使用。
- web:
  - `api.startPreview` / `startBranchPreview` を `StartPreviewOptions` 受け取りに変更。
  - `PreviewActions.start(opts?)` に一般化。PreviewPanel に「トンネル維持で再ビルド」「ボリューム破棄して再ビルド」ボタンを追加。

## 確認
- `npm run typecheck` / `npm run build -w web` / `npm test`(Node 24, 全27) / `npm run format`
