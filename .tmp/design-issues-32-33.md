# 設計: issue #32(破棄せず停止)/ #33(ビルド中の停止・破棄)

`feat/issues-32-33-lifecycle`ブランチ(最新mainから)。ライフサイクルコードが重複するため1ブランチで実装。

## #33: ビルド中断方式(ユーザー選択)
ワーカーは逐次のまま、進行中ビルドを中断できるようにする。

- `service.ts`に`activeBuilds = Map<previewId, AbortController>`。
- `runCommand`に`signal?: AbortSignal`を追加。abort時に子プロセスをSIGKILLしてキャンセルエラーでreject。
- `buildPreview`: 開始時にcontrollerを登録、全runCommandにsignalを渡す。finallyで登録解除。
  catchでabort済みなら「キャンセル」として扱い、teardownジョブに最終ステータスを委ねる。
- `cancelBuild(previewId)`をexport。
- 停止/破棄ルートはenqueue前に`cancelBuild(previewId)`を呼ぶ → 進行中ビルドがkillされ、
  ワーカーの`await buildPreview`が解放 → 次の停止/破棄ジョブを処理。

## #32: 破棄せず停止(stop without destroy)
- `stopPreview(previewId)`: (ビルド中なら中断 →)`docker compose stop`でコンテナを残したまま停止。
  トンネルを停止。ステータス`paused`。hostPortは保持(ポート確保維持)。url=null。
- 「再開」は既存の`restartPreview`を流用(`docker compose restart`は停止中コンテナも起動する)。
- 破棄(destroy)は従来通り全削除→`stopped`。

## #33 追加: ビルドの並列化(ワーカー並列化)
中断方式に加えて、ユーザー要望によりワーカーを並列化する。
- `env.ts`に`PREVIEW_JOB_CONCURRENCY`(デフォルト3)。
- `worker.ts`: 同時実行数の上限内でジョブを並列処理。
  - **preview単位で直列化**(`inFlightPreviews` Set): 同一previewへのbuildとstop/destroyが同時に走らないようにする。
    中断方式と両立(stop/destroyルートが`cancelBuild`で進行中ビルドをkill → 解放後に該当ジョブを処理)。
  - ジョブのclaimは`updateMany(where status=queued)`でアトミックに行い、重複tickでの二重取得を防ぐ。
  - previewIdは同期的に予約してからclaimし、同tick/重複tickでの競合を防ぐ。
- ポート割り当て競合対策: `ports.ts`に`reserveHostPort(previewId)`を追加。mutexで直列化し、
  確保と同時にDBへ予約することで並列ビルドの二重割り当てを防ぐ。`buildPreview`で使用。

## ジョブ/ルート
- `JobType`に`stop`追加。worker分岐に`stopPreview`。
- 汎用`POST /preview/:id/stop`、PR用`POST /pulls/:number/preview/stop`を追加。
- 既存の破棄(destroy)・stopルートはenqueue前に`cancelBuild`を呼ぶ。

## フロント
- `PreviewStatusBadge`に`paused`(「一時停止中」)追加。
- `PreviewActions`に`stop`追加。`PreviewPanel`:
  - running時: 「停止(保持)」ボタン追加(stop)。
  - paused時: 「再開」(restart)+「停止・破棄」(destroy)。
  - isActive/ボタン表示条件を調整。
- `api/client.ts`: stopPreview(PR)/stopPreviewById、PullDetailView/BranchPreviewsのactionsにstop追加。

## 確認
- `npm run typecheck` / `npm test`(Node 24) / `npm run build -w web` / `npm run format`
