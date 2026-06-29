# 設計: issue #24 PRのタグ表示(Labels / Milestone)

`feat/issue-24-pr-labels`ブランチ(mainから分岐)で実装する。

## 背景
PR一覧でLabelsとMilestoneを表示したい。

## 実装方針(#18 draftと同様のパターン)
- サーバー
  - `schema.prisma`の`PullRequest`に`labels String?`(JSON文字列)と`milestone String?`(タイトル)を追加。
    既存の`fileRewrites`/`overlayFiles`同様、配列はJSON文字列で保持する規約に合わせる。
  - `github/pulls.ts`: `GitHubPullLike`に`labels?: Array<{ name; color }>`と`milestone?: { title } | null`を追加。
    `mapPullToRecord`で`labels`をJSON文字列化(name/colorのみ)、`milestone`はタイトル文字列を保存。
  - PR一覧ルートは生の行を返すため変更不要(`labels`/`milestone`が自動で含まれる)。
- web
  - `types.ts`: `PrLabel { name; color }`を追加。`PullRequestDTO`に`labels: string | null`と`milestone: string | null`を追加(JSON文字列は表示側でparse、既存規約に準拠)。
  - `RepoPullsView.vue`: `labels`をparseして色付きチップ(色ドット+名前)で表示、`milestone`をアイコン付きで表示。

## マイグレーション方針
- 当初#23(draft追加)が未マージ前提で手書きマイグレーションを検討したが、作業中に**#23がmainへマージ済み**と判明。
  最新mainを基点に作り直したことで、draftを含むスキーマの上に重ねられ、並行マイグレーションの競合は解消。
- 結果、`prisma migrate dev --name add_pr_labels_milestone`を安全に使用。生成されたSQLは追加型のみ:
  `ALTER TABLE "PullRequest" ADD COLUMN "labels" TEXT; ADD COLUMN "milestone" TEXT;`(非破壊・draft保持)。
- 注意: ローカルでテスト実行時に`better-sqlite3`のネイティブモジュール読み込みエラーが出たため`npm rebuild better-sqlite3`で解消(環境依存。コード変更ではない)。

## 確認
- `npm run typecheck`(server + web)
- `npm run format`(範囲外ファイルを巻き込まないよう変更ファイルのみ整形)
