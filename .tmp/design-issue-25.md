# 設計: issue #25 ブランチからのプレビュー起動

`feat/issue-25-branch-preview`ブランチ(最新mainから)。

## 目的
PRだけでなく、GitHubの任意のブランチを選択してDockerプレビューを起動できるようにする。

## 方針: PreviewEnvironmentの汎用化(ユーザー選択)
プレビューを「PR」または「ブランチ」を対象にできるよう一般化する。

### スキーマ(PreviewEnvironment)
- `pullRequestId String? @unique`(nullable化)
- `kind String @default("pr")` // "pr" | "branch"
- `repositoryId String?`(ブランチ時のリポジトリ)
- `branchRef String?`(ブランチ名)
- `repository Repository? @relation(...)`(+ `Repository.previews PreviewEnvironment[]`)
- `@@unique([repositoryId, branchRef])`(同一ブランチの再起動で行を再利用。PR行はnullで衝突しない)

### サービス(preview/service.ts)
- `buildPreview`/`destroyPreview`/`restartPreview`を**previewId基点**に汎用化。
- `resolveBuildTarget(preview)`でPR/ブランチを解決:
  - PR: repo=pullRequest.repository, fetchRef=`pull/{number}/head`, knownSha=headSha, project=`preview-{o}-{n}-pr{num}`
  - branch: repo=repository, fetchRef=branchRef, knownSha=null(clone後に`git rev-parse HEAD`で解決), project=`preview-{o}-{n}-branch-{sanitized}`
- `prepareWorkspace`を`fetchRef`引数に一般化し、checkout後のSHAを返す。

### ジョブ
- `JobPayload`を`{ previewId: string; noCache?: boolean }`に変更。worker/各routeを合わせる。
- pulls.tsのclose時destroyはpreviewを引いてprevewId渡し。

### ルート
- `GET /repositories/:owner/:name/branches` GitHubブランチ一覧
- `POST /repositories/:owner/:name/branch-preview` { branch, noCache } ブランチ起動(branch名のスラッシュ対応のためbody渡し)
- `GET /repositories/:owner/:name/branch-previews` リポジトリのブランチプレビュー一覧
- `GET /preview/:id` 単体取得 / `POST /preview/:id/restart` / `DELETE /preview/:id`(previewId基点の汎用操作)
- 既存PRルート(start/restart/destroy)は維持し、内部でpreviewId基点ジョブへ変換(PR UIは無改修)。

### フロント
- `PreviewPanel.vue`を`actions`コールバック+`initialPreview`駆動に一般化(PR/ブランチ共通)。PullDetailViewはPR用actionsを渡す。
- `BranchPreviews.vue`新規: ブランチ選択ドロップダウン+起動、リポジトリのブランチプレビュー一覧(各PreviewPanel)。RepoPullsViewに設置。
- `api/client.ts`: getBranches/startBranchPreview/getBranchPreviews/getPreviewById/restartPreviewById/destroyPreviewById。
- `types.ts`: PreviewDTOに`kind`/`branchRef`/`repositoryId`、PreviewListItemをPR null許容+repository対応。BranchInfo型。
- DashboardViewの稼働中一覧をブランチプレビュー対応(ブランチ名表示)。

## マイグレーション
- pullRequestId nullable化 + 列追加 + FK追加のためSQLiteはテーブル再定義になる見込み。既存PR行はkind="pr"で保持。
- `prisma migrate dev`(#23マージ済みでドリフトなし)→ generate。

## 確認
- `npm run typecheck` / `npm test`(全パス) / `npm run format`(変更ファイルのみ)
