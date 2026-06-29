# 設計: issue #17 / #18 / #20

3件のissueをまとめて`feat/issues-17-18-20`ブランチで実装する。

## issue #17: PRの最新コミットハッシュと起動中インスタンスのコミットハッシュ表示

### 背景
PRの最新コミットと、現在稼働中のプレビューがどのコミットでビルドされたかを比較し、プレビューが最新かどうかを分かりやすく表示したい。

### 現状調査の結論
- データは既に揃っており、**サーバー/DB変更は不要**。
  - `PullRequest.headSha`: PRの最新コミットSHA(取得・保存済み)
  - `PreviewEnvironment.commitSha`: ビルド時に記録されるコミットSHA(記録済み)
  - 両者ともDTO(`PullRequestDTO.headSha` / `PreviewDTO.commitSha`)に露出済み。
- よってUI側でこの2つを比較表示するだけでよい。

### 実装方針(UIのみ)
- `PreviewPanel.vue`
  - props に `prHeadSha?: string` を追加。
  - `commitSha` をrefで保持し、`initialPreview`と`refresh()`で更新する。
  - ビルド済みSHAと最新SHAを短縮表示(7文字)し、一致なら「最新」、不一致なら「新しいコミットあり」を示す。
- `PullDetailView.vue`
  - `PreviewPanel`へ`:pr-head-sha="pr.headSha"`を渡す。

## issue #18: Draft PRを区別

### 実装方針
- サーバー
  - `schema.prisma`の`PullRequest`に`draft Boolean @default(false)`を追加。
  - マイグレーション追加 + `prisma generate`。
  - `github/pulls.ts`の`GitHubPullLike`に`draft?: boolean`、`mapPullToRecord`に`draft: pr.draft ?? false`を追加。
- web
  - `types.ts`の`PullRequestDTO`に`draft: boolean`を追加。
  - `DraftBadge.vue`を新規作成(`BaseBadge`を利用)。
  - `RepoPullsView.vue`(一覧)と`PullDetailView.vue`(詳細)でDraftバッジを表示。

## issue #20: Dockerビルドキャッシュ破棄(no-cache再ビルド)

### 現状調査の結論
- ビルドは`docker compose up -d --build`(CLIを`spawn`)。`up`は`--no-cache`非対応のため、
  no-cache時は`docker compose build --no-cache`→`docker compose up -d`の2段階にする。

### 実装方針
- `jobs/queue.ts`: `JobPayload`に`noCache?: boolean`を追加。
- `jobs/worker.ts`: buildジョブで`buildPreview(payload.pullRequestId, payload.noCache)`を渡す。
- `preview/service.ts`: `buildPreview(pullRequestId, noCache = false)`。
  - `noCache`時: `docker compose build --no-cache`実行後に`up -d`。
  - 通常時: 既存の`up -d --build`。
- `routes/repositories.ts`: POST `.../preview`でbody`{ noCache?: boolean }`を解析しジョブへ渡す。
- web `api/client.ts`: `startPreview`に`noCache`オプションを追加。
- `PreviewPanel.vue`: 「キャッシュ破棄して再ビルド」ボタンを追加。

## テスト/確認
- `npm run typecheck`(server + web)が通ること。
- `npm run format`で整形。
- `prisma migrate`でdraftカラムが追加されること(可能な範囲で)。

## 備考
プロジェクト全体の設計書は`.tmp/design.md`にあるため上書きせず、本タスク専用に本ファイルを作成した。
