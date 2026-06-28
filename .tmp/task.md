# タスク一覧: PR プレビュー環境オーケストレーター

設計書: `.tmp/design.md`
構成: モノレポ(npm workspaces)/ web = Vite+Vue3 / server = Hono+Prisma(SQLite)

## M1: 基盤セットアップ
- [x] モノレポ(npm workspaces)構築
- [x] server: Hono + tsx + tsconfig
- [x] web: Vite + Vue 3 + Tailwind CSS v4
- [x] Prettier 設定
- [x] Prisma + SQLite、schema定義、マイグレーション、クライアント生成
- [x] 環境変数ローダ(zod)、.env.example
- [x] 共通レイアウト(AppHeader)・ルーター・ダッシュボード

## M2: GitHub連携(読み取り)
- [x] GitHub App認証(@octokit/app、installation token)
- [x] リポジトリ同期API + ダッシュボード表示
- [x] PR一覧API + 表示
- [x] PR詳細(本文・メタ)
- [x] diff取得 + DiffView(diff2html)
- [x] コメント(issue/review-comment/review)取得 + CommentList
- [x] リポジトリのプレビュー設定CRUD + 設定画面

## M3: プレビュー起動(簡易版・動的ホストポート)
- [x] ジョブキュー + インプロセスワーカー(DBポーリング)
- [x] installation token取得、git clone/fetch + PR head checkout
- [x] compose override生成(動的ホストポート)
- [x] docker compose up/down、状態遷移管理
- [x] ビルドログ収集 + SSE配信
- [x] プレビュー起動/再ビルド/破棄 API + PreviewPanel UI + ログ表示

## 仕上げ
- [x] コードフォーマット
- [x] .gitignore整備
- [x] README(セットアップ・GitHub App作成・起動手順)
- [ ] 実機動作確認(GitHub App + Docker対応リポジトリ: ユーザー環境で実施)

## 今後(M4以降・未着手)
- [ ] M4: Webhook自動化(PR opened/synchronize/closed)
- [ ] M5: Traefik対応(*.preview.localhost サブドメイン)
- [ ] M6: クリーンアップ・リトライ・同時実行制限・本番ビルド

## 横断メモ
- この環境は NODE_ENV=production のため `npm install` 時は `--include=dev` が必要
- API は PORT ではなく API_PORT を使用(環境の PORT=3456 と衝突回避)
