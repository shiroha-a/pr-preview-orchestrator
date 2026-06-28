# PR Preview Orchestrator

GitHubと連携し、Pull Requestごとにエフェメラルなプレビュー環境(アプリ)をローカルのDocker上に構築するツールです。WebUIからPRを指定して、PR内容・diff・コメントを確認しつつ、ワンクリックでプレビュー環境を起動・停止・破棄できます。

## 構成

モノレポ(npm workspaces)。

| ディレクトリ | 役割 | 技術 |
| --- | --- | --- |
| `web` | WebUI(SPA) | Vite + Vue 3 + Tailwind CSS |
| `server` | APIサーバー / オーケストレーター | Hono + Prisma(SQLite)+ Octokit + Docker CLI |

主な流れ: WebUI →(`/api`)→ Hono → GitHub(Octokit)/ Docker(`docker compose`)。
ビルドは非同期ジョブ(インプロセスワーカー)で実行し、ログ・状態をSSEでWebUIへ配信します。

## 必要環境

- Node.js 22+
- Docker / Docker Compose
- git

## セットアップ

```bash
# 1. 依存をインストール
#    環境変数 NODE_ENV=production だと devDependencies がスキップされるため
#    --include=dev を付けています。
npm install --include=dev

# 2. データベースを初期化(SQLite)
npm run db:migrate

# 3. サーバーの環境変数を設定
cp server/.env.example server/.env
#    server/.env を編集して GitHub App の認証情報を入力
```

## GitHub Appの作成

1. GitHub の Settings → Developer settings → GitHub Apps → New GitHub App
2. 権限(Repository permissions):
   - **Contents**: Read-only(clone用)
   - **Pull requests**: Read-only
   - **Metadata**: Read-only
3. (任意)Webhook を有効にし、`Pull requests` / `Issue comments` を購読
4. Private key を生成して App ID を控える
5. 対象リポジトリに App を Install する
6. `server/.env` に以下を設定:
   - `GITHUB_APP_ID`
   - `GITHUB_APP_PRIVATE_KEY`(PEM。複数行は `\n` エスケープ可)
   - `GITHUB_WEBHOOK_SECRET`(Webhookを使う場合)

## 起動

```bash
npm run dev
```

- API サーバー: http://localhost:8787
- WebUI: http://localhost:5173 (Vite が `/api` を API サーバーへプロキシ)

## 使い方

1. **設定**ページで GitHub App 接続を確認し、「リポジトリを同期」
2. リポジトリを開き「PRを同期」→ PR を選択
3. リポジトリの**プレビュー設定**で以下を登録:
   - Compose ファイルのパス(例: `docker-compose.yml`)
   - 公開 Web サービス名(compose 内のサービス名)
   - 内部ポート(そのサービスがコンテナ内で Listen するポート)
4. PR 詳細画面で「プレビューを起動」。ビルドログがリアルタイムに表示され、起動後にアクセス URL が出ます。

## 対象リポジトリの前提

- ルート(または設定したパス)に `docker-compose.yml` がある
- 公開したい Web サービスが1つ特定できる(設定でサービス名・内部ポートを指定)
- プレビュー時は compose override で当該サービスに動的ホストポートをマッピングします

## 制約・注意

- **信頼できるリポジトリのみ**を対象にしてください(対象リポジトリの任意コードをローカル Docker で実行します)。
- 現状の URL は `http://localhost:<割り当てポート>` 形式です(動的ホストポート方式)。
- Webhook によるPRイベント自動化(M4)、Traefik によるサブドメインルーティング(M5)は今後の拡張です。

## スクリプト

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | server と web を同時起動 |
| `npm run typecheck` | 型チェック(server + web) |
| `npm run format` | Prettier で整形 |
| `npm run db:migrate` | Prisma マイグレーション |
| `npm run db:studio` | Prisma Studio |
