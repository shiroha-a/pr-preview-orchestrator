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
