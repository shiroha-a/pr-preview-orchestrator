# PR Preview Orchestrator

GitHubと連携し、Pull Requestごとにエフェメラルなプレビュー環境(アプリ)をローカルのDocker上に構築するツールです。WebUIからPRを指定して、PR内容・diff・コメントを確認しつつ、ワンクリックでプレビュー環境を起動・停止・破棄できます。プレビューは **Cloudflare Quick Tunnel**(`*.trycloudflare.com`)で外部公開されます。

## 主な機能

- PR の内容・**diff**・**コメント/レビュー**を WebUI で確認
- PR ごとに Docker でプレビュー環境を**起動 / 再ビルド / 再起動 / 停止 / 破棄**
- **Cloudflare Quick Tunnel** で `*.trycloudflare.com` に外部公開
- ビルドログ + コンテナ実行ログの**リアルタイム表示**(SSE)
- **ダッシュボードで稼働中プレビューを集約表示**
- **システム(メモリ/ディスク)とプレビューコンテナのリソース使用状況をリアルタイム表示**
- **Dockerのディスク使用状況表示**(`docker system df`相当)と**クリーンアップ**(ビルドキャッシュ全削除・破棄済みプレビューの不要イメージ削除)
- **ファイル書き換えルール**(設定ファイルへプレビューURLを注入)・**ボリューム初期化**
- **composeファイルの複数指定**(後のファイルが前を上書き)・**設定プロファイル**(既定設定を項目単位で上書きし起動時に選択)
- **GitHub Webhook** によるPR push時の自動再ビルド・クローズ時の自動破棄
- **管理画面/APIのBasic認証**(任意)
- **リポジトリの削除**(プレビュー破棄 + データ一括削除)・**プレビュー設定のエクスポート/インポート**
- **公開GitHub API** 利用(GitHub App不要、任意でPATによりレート緩和・private対応)
- 開発(Vite HMR)/ 本番(単一プロセス配信)の両対応

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

# 3. (任意)サーバーの環境変数を設定
#    .env が無くてもデフォルト値で動作します(公開API・SQLite: file:./dev.db)。
#    private リポジトリ・Webhook・Basic認証を使う場合に設定します。
cp server/.env.example server/.env
#    必要に応じて server/.env を編集してください。
```

> 補足: `npm install` 時に Prisma クライアントが自動生成され(`postinstall`)、`npm run build` でも生成されます。
> `.env` が無い場合、データベースは `file:./dev.db` にフォールバックします。

## 環境変数

`server/.env`(`server/.env.example` をコピーして作成)で設定します。**すべて任意**で、未設定でも動作します。

| 変数                            | 説明                         | デフォルト         |
| ------------------------------- | ---------------------------- | ------------------ |
| `DATABASE_URL`                  | SQLite のパス                | `file:./dev.db`    |
| `API_PORT`                      | API サーバーのポート         | `8787`             |
| `GITHUB_TOKEN`                  | PAT(private / レート緩和)    | (なし=公開APIのみ) |
| `GITHUB_WEBHOOK_SECRET`         | Webhook 署名検証             | (なし)             |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 管理画面/APIの Basic 認証    | (なし=認証なし)    |
| `PREVIEW_TUNNEL`                | Cloudflare トンネルの有効化  | `true`             |
| `WORKSPACES_DIR`                | リポジトリの clone 先        | `./workspaces`     |
| `PREVIEW_PORT_MIN` / `..._MAX`  | プレビューのホストポート範囲 | `13000` / `13999`  |

## 起動

開発(ホットリロード):

```bash
npm run dev
```

- API サーバー: http://localhost:8787
- WebUI: http://localhost:5173 (Vite が `/api` を API サーバーへプロキシ)

本番(単一プロセス):

```bash
npm run build   # web を静的ビルド + server を dist にバンドル
npm start       # http://localhost:8787 で WebUI と API を同一ポートで配信
```

## 使い方

1. **設定**ページで、リポジトリを `owner/name` 形式(例: `vercel/next.js`)で追加
2. リポジトリを開き「PRを同期」→ PR を選択
3. リポジトリの**プレビュー設定**で以下を登録:
   - Compose ファイルのパス(例: `docker-compose.yml`)
   - 公開 Web サービス名(compose 内のサービス名)
   - 内部ポート(そのサービスがコンテナ内で Listen するポート)
4. PR 詳細画面で「プレビューを起動」。ビルドログがリアルタイムに表示され、起動後に
   `https://<ランダム>.trycloudflare.com` の公開URLが出ます。
5. 稼働中のプレビューは**ダッシュボード**に集約表示されます。

## GitHub連携(公開API)

本ツールは **公開GitHub REST API** を使用します。GitHub App やインストールは不要です。

- 認証なしでも **公開リポジトリ** の PR・diff・コメントを取得できます(レート制限あり)。
- `server/.env` の `GITHUB_TOKEN` に Personal Access Token を設定すると、レート制限が緩和され、**privateリポジトリ** にもアクセスできます。

## プレビューの外部公開(Cloudflare Quick Tunnel)

プレビュー起動時に `cloudflared tunnel --url http://localhost:<ポート>` で使い捨てトンネルを立て、
`*.trycloudflare.com` の公開URLを払い出します。破棄時にトンネルも停止します。

- `cloudflared` が未インストール、または起動に失敗した場合は `http://localhost:<ポート>` にフォールバックします。
- `PREVIEW_TUNNEL=false` でトンネルを無効化できます。

## 対象リポジトリの docker-compose.yml

対象リポジトリは `<WORKSPACES_DIR>/<owner>__<name>__pr<番号>`(既定 `server/workspaces/...`)に
clone され、その中で `docker compose ... up -d --build` が実行されます。

- **前提**: ルート(または設定した Compose パス)に `docker-compose.yml` があり、公開したい
  Web サービスが1つ特定できること。
- **プレビュー設定**(リポジトリ設定画面):
  - Compose ファイルのパス(例: `docker-compose.yml`)。**1行1ファイルで複数指定**でき、
    `docker compose -f a.yml -f b.yml` のように連結されて**後のファイルが前の定義を上書き**します(issue #52)
  - 公開 Web サービス名(compose 内の service 名、例: `web`)
  - 内部ポート(その service がコンテナ内で Listen するポート、例: `3000`)
- **ビルドディレクトリ**: compose の `build:` の context は clone 先のリポジトリルートです。
  既存の `build: .` や `build: ./docker` はそのまま使えます。
- **ポート**: オーケストレーターが override を生成し、公開 Web サービスの内部ポートに
  **動的なホストポート**を割り当てます。既存の `ports:` は Compose の `!override` で置き換えるため、
  **既存の `docker-compose.yml` をそのまま使えます**(複数PR同時起動でもポートが競合しません)。
- 記入例: [`examples/docker-compose.example.yml`](examples/docker-compose.example.yml)

## 高度な設定(ファイル書き換え・初期化・自動破棄)

リポジトリの**プレビュー設定**で以下も設定できます。

- **ファイル書き換えルール**: clone後・起動前に、対象リポジトリ内の既存ファイルを正規表現で書き換えます。
  置換文字列で `{{PREVIEW_URL}}` / `{{PREVIEW_HOST}}` / `{{HOST_PORT}}` を展開できるため、トンネルURLを設定ファイルへ注入できます。
  - 例(Misskey): 対象 `.config/default.yml`、パターン `^url:.*`、置換 `url: {{PREVIEW_URL}}`
- **オーバーレイファイル**: 対象リポジトリ**外**で用意したファイル(テスト用 compose、`default.yml`
  などの設定、volumes 設定)を clone 先に丸ごと配置します。内容で `{{PREVIEW_URL}}` 等を展開できるため、
  trycloudflare ドメインを含む設定ファイルも注入できます。テスト用 compose を配置して `composePath` に
  そのファイル名を指定すれば、対象リポジトリの compose を使わずにプレビューできます。
- **ボリューム初期化**: 起動のたびに `docker compose down -v` でDB・ファイル等のボリュームを初期化します。
- **設定プロファイル**: 既定のプレビュー設定を**項目単位で上書き**する名前付きプロファイルを作成できます
  (例: 検索用の外部サーバーを含む compose を追加した「検索あり」プロファイル)。プレビューの起動/再ビルド時に
  選択でき、プロファイルを切り替えて再ビルドしても**ボリュームとトンネル(URL)は維持**されます(issue #52)。
  オーバーレイファイルのみ置換ではなく**既定への追加**です: 既定のファイルを残したままファイルを追加し
  (同じパスは内容を上書き)、既定のファイルを外したい場合は「配置しない」を明示します(issue #56)。
- **自動破棄**: PRがクローズ/マージされると、PR同期時に対応するプレビューを自動で破棄します。破棄時は
  `docker compose down -v --remove-orphans --rmi local` で全コンテナ(DB等)・孤児コンテナ・ボリューム・
  ビルド済みイメージ(compose既定名のもの)を削除します。

## Webhookによる自動化(任意)

GitHubのWebhookを設定すると、PRイベントに応じてプレビューを自動更新できます。

1. このサーバーを外部公開する(GitHubから到達できるURLが必要。例: `cloudflared tunnel --url http://localhost:8787`)
2. `server/.env` に `GITHUB_WEBHOOK_SECRET` を設定
3. 対象リポジトリの Settings → Webhooks → Add webhook:
   - **Payload URL**: `<公開URL>/api/github/webhook`
   - **Content type**: `application/json`
   - **Secret**: 上記と同じ値
   - **イベント**: `Pull requests`
4. 動作:
   - PR push(`synchronize`): 稼働中プレビューを自動再ビルド
   - PR クローズ/マージ(`closed`): プレビューを自動破棄

## アクセス制御(任意)

`server/.env` に `ADMIN_USER` と `ADMIN_PASSWORD` を設定すると、管理画面(WebUI)とAPIに
HTTP Basic認証がかかります。サーバーを外部公開する場合に管理操作を保護できます。

- ヘルスチェック(`/api/health`)と GitHub Webhook(`/api/github/webhook`)は認証対象外です(Webhookは署名で検証)。
- プレビュー環境(`*.trycloudflare.com`)自体には認証はかかりません。

## 制約・注意

- **信頼できるリポジトリのみ**を対象にしてください(対象リポジトリの任意コードをローカル Docker で実行します)。
- Cloudflare Quick Tunnel の URL は**誰でもアクセス可能**です。機微な内容を含むプレビューには注意してください(プレビュー環境自体への認証は今後の拡張候補)。
- 今後の拡張候補: ビルドの並列実行、プレビュー環境への認証、Traefik 等によるサブドメインルーティング。

## スクリプト

| コマンド             | 説明                                 |
| -------------------- | ------------------------------------ |
| `npm run dev`        | server と web を同時起動(開発)       |
| `npm run build`      | web を静的ビルド + server を dist 化 |
| `npm start`          | 本番起動(単一プロセスで WebUI + API) |
| `npm run typecheck`  | 型チェック(server + web)             |
| `npm run format`     | Prettier で整形                      |
| `npm run db:migrate` | Prisma マイグレーション              |
| `npm run db:studio`  | Prisma Studio                        |

## ライセンス

[MIT License](./LICENSE) © shiroha-a
