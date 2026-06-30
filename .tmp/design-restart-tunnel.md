# 設計: サーバー再起動時にCFトンネルが張られずリンク切れ

`fix/reattach-tunnel-on-restart`ブランチ。

## 症状
システム(Nodeサーバー)を再起動すると、稼働中プレビューのCloudflare Quick Tunnelが
張り直されず、プレビューURLがリンク切れになる。

## 原因
- トンネル(cloudflared)はプレビュー単位の子プロセスで、`tunnel.ts`の`tunnels` Map
  (in-memory)で管理。
- サーバー再起動でDockerコンテナは生き残るが、cloudflaredプロセスとMapは失われる。
- 起動復旧(`startWorker`)は pending/cloning/building/stopping を failed にするだけで、
  `running`のプレビューは古い(死んだ)URLのまま放置 → リンク切れ。
- トンネルを張り直す処理が起動時に無い。

## 修正
- `service.ts`に`reattachPreview(previewId)`を追加:
  - status==="running" かつ hostPort ありのときのみ対象。
  - トンネルが切れていれば`startTunnel`で張り直し、`url`をDB更新、`emitPreviewStatus("running")`で
    開いているパネルにURL更新を促す。
  - 失われた実行時ログストリームも`startLogStream`で再開。
  - コンテナは再起動しない(トンネル/ログのみ復旧、ダウンタイム無し)。
- `reattachRunningPreviews()`で running 全件を逐次(cloudflared大量起動を避ける)に張り直す。
- `worker.ts`の`startWorker`で復旧処理の後に`void reattachRunningPreviews()`を
  fire-and-forget で実行(起動をブロックしない)。

## 留意
- ホスト再起動でコンテナごと消えた場合は対象外(再ビルドが必要)。本修正はNodeプロセス
  再起動でコンテナが生存しトンネルだけ切れるケースを対象とする。

## 確認
- `npm run typecheck`(server) / `npm test`(Node 24, 全27) / `npm run format`
