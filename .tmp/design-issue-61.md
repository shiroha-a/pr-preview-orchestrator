# issue #61: volumeのインポート/エクスポート

## 目的

プレビュー環境のDockerボリューム(DB等)をtar.gzとしてダウンロード(エクスポート)し、
逆にアップロードして復元(インポート)できるようにする。オーケストレーター自体が
Cloudflare経由で公開されているため、アップロードは分割してCFのリクエストbody
サイズ上限(既定100MB)を回避する。

## 設計

### 全体像

- エクスポート: `GET`でtar.gzをストリーミングダウンロード。
  ヘルパーコンテナ(busybox)でボリュームをread-onlyマウントし`tar | gzip`をstdout経由で返す。
  ストリーミングは即座に応答が始まるためCFのタイムアウト(524)に掛からない。
- インポート: クライアントがファイルを32MiBチャンクに分割して順次アップロード
  (CFの100MB上限を回避)。全チャンク受信後の復元処理は時間がかかりうるので
  既存のジョブキューに`volume-import`ジョブとして投入し、HTTPリクエストを
  長時間占有しない(CFの~100秒タイムアウト回避)。進捗ログは既存のSSE
  (`emitPreviewLog`)でプレビューパネルのログに流す。

### サーバー

新規モジュール:

- `preview/uploads.ts`: 分割アップロードのセッション管理(メモリ+一時ファイル)。
  - セッション: `{id, previewId, volume, totalChunks, totalSize, received, bytes, path, createdAt}`
  - チャンクは0から順序どおりに受信(`index === received`を強制)し一時ファイルへ追記
  - `finish`で受信チャンク数・合計サイズを検証
  - TTL 1時間で遅延掃除(新規セッション作成時にsweep)。サーバー再起動で消えてよい
  - 置き場: `os.tmpdir()/pr-preview-volume-uploads/`(dockerへはstdinで流すので共有不要)
- `preview/volumes.ts`: docker操作。
  - `listComposeVolumes(project)`: `docker volume ls --filter label=com.docker.compose.project=<project>`。
    サイズは`du -sm`をヘルパーコンテナで実行(失敗時はnull=不明)
  - `volumeBelongsToProject(name, project)`: `docker volume inspect`のcomposeラベルで所属検証
  - `runningContainersUsingVolume(name)`: `docker ps --filter volume=<name>`
  - `exportVolumeStream(name)`: `docker run --rm -v <vol>:/data:ro busybox sh -c "cd /data && tar cf - . | gzip"`
    のstdoutを返す(クライアント切断でkill)
  - `importVolume(previewId, volume, archivePath)`(ジョブ本体):
    1. ボリューム所属・実行中コンテナなしを再検証
    2. 検証: `gzip -dc | tar tf -`で**破棄前に**アーカイブ整合性を確認(壊れたファイルでデータを失わない)
    3. 初期化: `find /data -mindepth 1 -delete`
    4. 復元: `gzip -dc | tar xf - -C /data`(rootで実行するためuid/gidが保持される)
    5. 成否に関わらず一時ファイルを削除。ログはSSEで配信

APIルート(`routes/preview.ts`、全て既存のbasic auth配下):

- `GET  /api/preview/:id/volumes` → `{volumes: [{name, sizeMb}]}`
- `GET  /api/preview/:id/volumes/:volume/export` → tar.gzストリーム(attachment)
- `POST /api/preview/:id/volumes/:volume/import/start` `{totalChunks, totalSize}` → `{uploadId}`
  - 実行中コンテナがあれば409で即失敗(アップロード前にフェイルファスト)
- `POST /api/preview/:id/volumes/:volume/import/:uploadId/chunk/:index`(application/octet-stream)
- `POST /api/preview/:id/volumes/:volume/import/:uploadId/finish` → `volume-import`ジョブ投入 → `{jobId}`
- `DELETE /api/preview/:id/volumes/:volume/import/:uploadId` → セッション破棄(失敗時の掃除)

ジョブ: `queue.ts`の`JobType`に`volume-import`、payloadに`volume`/`uploadPath`を追加。
同一preview宛ジョブは既存の仕組みで直列化されるため、ビルドとインポートは競合しない。

env: `PREVIEW_VOLUME_HELPER_IMAGE`(既定`busybox:stable`)を追加。`.env.example`にも記載。

### 安全策

- ボリューム名の形式検証+composeプロジェクトラベルでの所属検証(他プレビューのボリュームは触れない)
- インポートは対象ボリュームを使う実行中コンテナがあると実行不可
  (「停止(保持)」してから実施。start時とジョブ実行時の二段階でチェック)
- アーカイブ検証は既存データの削除より先に行う

### Web

- `api/client.ts`: `listPreviewVolumes` / `volumeExportUrl` /
  `importPreviewVolume(id, volume, file, onProgress)`(start→chunkループ→finish。
  チャンクはバイナリのため素のfetch。失敗時はDELETEで後始末)。チャンクサイズ32MiB
- 新規`components/VolumesModal.vue`: ボリューム一覧(名前・サイズ)、
  エクスポート(ダウンロードリンク)、インポート(ファイル選択→確認ダイアログ→
  進捗バー→ジョブ開始メッセージ)。`status === 'running'`中はインポート無効+説明表示
- `PreviewPanel.vue`: 「ボリューム」ボタン(非アクティブかつ`status !== 'idle'`で表示)で
  モーダルを開く

## テスト

- 追加: `server/test/preview/uploads.test.ts`(セッション管理: 順序違反・サイズ不一致・
  finish・破棄・期限切れ掃除)
- `npm run typecheck` / `npm run test -w server` / `npm run build -w web`
- docker操作(エクスポート/インポート本体)は実環境依存のため手動確認
