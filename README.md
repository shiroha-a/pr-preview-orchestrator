# PR Preview Orchestrator

GitHubと連携し、Pull Requestごとにエフェメラルなプレビュー環境(アプリ)をローカルのDocker上に構築するツールです。WebUIからPRを指定して、PR内容・diff・コメントを確認しつつ、ワンクリックでプレビュー環境を起動・停止・破棄できます。プレビューは **Cloudflare Quick Tunnel**(`*.trycloudflare.com`)で外部公開されます。

## 構成

モノレポ(npm workspaces)。

| ディレクトリ | 役割                             | 技術                                                              |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| `web`        | WebUI(SPA)                       | Vite + Vue 3 + Tailwind CSS                                       |
| `server`     | APIサーバー / オーケストレーター | Hono + Prisma(SQLite)+ Octokit(公開API)+ Docker CLI + cloudflared |

主な流れ: WebUI →(`/api`)→ Hono → GitHub(公開REST API)/ Docker(`docker compose`)/ Cloudflare Tunnel。
ビルドは非同期ジョブ(インプロセスワーカー)で実行し、ログ・状態をSSEでWebUIへ配信します。

## 必要環境

- Node.js 22+
- Docker / Docker Compose
- git
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)(プレビューの外部公開に使用。`PREVIEW_TUNNEL=false`なら不要)

## セットアップ

```bash
# 1. 依存をインストール
#    環境変数 NODE_ENV=production だと devDependencies がスキップされるため
#    --include=dev を付けています。
npm install --include=dev

# 2. データベースを初期化(SQLite)
npm run db:migrate

# 3. サーバーの環境変数を設定(任意)
cp server/.env.example server/.env
#    公開リポジトリだけならそのままでも動作します。
```

## GitHub連携(公開API)

本ツールは **公開GitHub REST API** を使用します。GitHub App やインストールは不要です。

- 認証なしでも **公開リポジトリ** の PR・diff・コメントを取得できます(レート制限あり)。
- `server/.env` の `GITHUB_TOKEN` に Personal Access Token を設定すると、レート制限が緩和され、**privateリポジトリ** にもアクセスできます。

## 起動

```bash
npm run dev
```

- API サーバー: http://localhost:8787
- WebUI: http://localhost:5173 (Vite が `/api` を API サーバーへプロキシ)

## 使い方

1. **設定**ページで、リポジトリを `owner/name` 形式(例: `vercel/next.js`)で追加
2. リポジトリを開き「PRを同期」→ PR を選択
3. リポジトリの**プレビュー設定**で以下を登録:
   - Compose ファイルのパス(例: `docker-compose.yml`)
   - 公開 Web サービス名(compose 内のサービス名)
   - 内部ポート(そのサービスがコンテナ内で Listen するポート)
4. PR 詳細画面で「プレビューを起動」。ビルドログがリアルタイムに表示され、起動後に
   `https://<ランダム>.trycloudflare.com` の公開URLが出ます。

## プレビューの外部公開(Cloudflare Quick Tunnel)

プレビュー起動時に `cloudflared tunnel --url http://localhost:<ポート>` で使い捨てトンネルを立て、
`*.trycloudflare.com` の公開URLを払い出します。破棄時にトンネルも停止します。

- `cloudflared` が未インストール、または起動に失敗した場合は `http://localhost:<ポート>` にフォールバックします。
- `PREVIEW_TUNNEL=false` でトンネルを無効化できます。

## 対象リポジトリの前提

- ルート(または設定したパス)に `docker-compose.yml` がある
- 公開したい Web サービスが1つ特定できる(設定でサービス名・内部ポートを指定)
- プレビュー時は compose override で当該サービスに動的ホストポートをマッピングします

## 高度な設定(ファイル書き換え・初期化・自動破棄)

リポジトリの**プレビュー設定**で以下も設定できます。

- **ファイル書き換えルール**: clone後・起動前に、対象ファイルを正規表現で書き換えます。置換文字列で
  `{{PREVIEW_URL}}` / `{{PREVIEW_HOST}}` / `{{HOST_PORT}}` を展開できるため、トンネルURLを設定ファイルへ注入できます。
  - 例(Misskey): 対象 `.config/default.yml`、パターン `^url:.*`、置換 `url: {{PREVIEW_URL}}`
- **ボリューム初期化**: 起動のたびに `docker compose down -v` でDB・ファイル等のボリュームを初期化します。
- **自動破棄**: PRがクローズ/マージされると、PR同期時に対応するプレビューを自動で破棄します。破棄時は
  `docker compose down -v --remove-orphans` で全コンテナ(DB等)・孤児コンテナ・ボリュームを削除します。

## 制約・注意

- **信頼できるリポジトリのみ**を対象にしてください(対象リポジトリの任意コードをローカル Docker で実行します)。
- Cloudflare Quick Tunnel の URL は**誰でもアクセス可能**です。機微な内容を含むプレビューには注意してください。
- Webhook によるPRイベント自動化(M4)、Traefik によるサブドメインルーティング(M5)は今後の拡張です。

## スクリプト

| コマンド             | 説明                     |
| -------------------- | ------------------------ |
| `npm run dev`        | server と web を同時起動 |
| `npm run typecheck`  | 型チェック(server + web) |
| `npm run format`     | Prettier で整形          |
| `npm run db:migrate` | Prisma マイグレーション  |
| `npm run db:studio`  | Prisma Studio            |
