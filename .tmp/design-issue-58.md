# issue #58: 「ボリューム破棄」「トンネル破棄」を選択して「再起動」しても残る

## 問題

プレビューパネルの再ビルドオプション(キャッシュ破棄/ボリューム破棄/トンネル破棄)のチェックボックスは、
UI上「再ビルド」ボタンと「再起動」ボタンの両方の隣に表示されるが、実際に適用されるのは「再ビルド」のみ。

- `PreviewPanel.vue` の `restart()` は `props.actions.restart()` をオプションなしで呼ぶ
- 再起動API(`POST /preview/:id/restart` / `POST /repositories/:owner/:name/pulls/:number/preview/restart`)はボディを受け取らない
- `restartPreview()`(server/src/preview/service.ts)は常に `docker compose restart` を実行し、
  トンネルは生存していれば必ず流用する

そのため「ボリューム破棄」「トンネル破棄」をチェックして「再起動」を押しても、
ボリュームもトンネル(URL)も破棄されずそのまま残る。

## 対応方針

「再起動」でもチェックボックス(ボリューム破棄/トンネル破棄)を適用する。
「キャッシュ破棄」はビルド時のみ意味を持つため再起動では対象外とし、ツールチップで明示する。

### サーバー側

- `restartPreview(previewId, opts)` に `RestartOptions { resetVolumes?, resetTunnel? }` を追加
  - `resetVolumes`: `docker compose restart` の代わりに `down -v --remove-orphans` →
    `up -d`(`--build` なし。既存イメージからコンテナを再作成し、ボリュームだけ初期化する)
  - `resetTunnel`: トンネル生存判定をスキップして `startTunnel()` を呼ぶ
    (内部で既存トンネルコンテナを `rm -f` してから新規作成するのでURLが変わる)。
    新規トンネル作成に失敗した場合、旧URLは既に無効なので `http://PREVIEW_HOST:hostPort` へ退避する
- API極性は再起動の既定(未指定=すべて維持)に合わせ「true=破棄」の `resetVolumes` / `resetTunnel` とする
  (ビルドAPIの `keepTunnel` は既定が「破棄」なので流用しない)
- `JobPayload` に `resetTunnel?: boolean` を追加(`resetVolumes` は既存フィールドを流用)
- 再起動ルート2箇所(preview.ts / repositories.ts)で任意ボディをパースしてジョブへ伝搬
- worker の `restart` ジョブでオプションを `restartPreview` へ伝搬

### Web側

- `client.ts`: `RestartPreviewOptions` を追加し、`restartPreview` / `restartPreviewById` が
  ボディで送信できるようにする
- `PreviewPanel.vue`:
  - `PreviewActions.restart` がオプションを受け取れるようシグネチャ変更
  - 「再起動」ボタンはチェックボックスの `resetVolumes` / `resetTunnel` を渡す
  - 「再開」(paused→restart)はチェックボックス非表示のためオプションなしで呼ぶ
    (`@click="restart"` のままだとMouseEventが第1引数に渡るため `restart()` に修正)
  - ツールチップを更新: キャッシュ破棄は「再ビルドのみ」、ボリューム/トンネル破棄は再起動にも適用と明示
- `PullDetailView.vue` / `BranchPreviews.vue`: restartアクションの配線にオプションを通す

## 影響範囲・互換性

- 再起動APIのボディは任意のため、既存クライアント(ボディなし)は従来どおり全維持で再起動
- ビルドAPI(`keepTunnel`)は不変

## テスト

- `npm run typecheck`(server tsc + web vue-tsc)
- `npm run test -w server`(既存テストの回帰確認)
