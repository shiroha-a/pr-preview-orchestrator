# PR プレビュー環境オーケストレーター 設計書

> 実装メモ(最新): フロントエンドはユーザー要望により **Vue** を採用。
> 当初のNext.jsフルスタックから、モノレポ(npm workspaces)構成に変更した:
> - `web`: Vite + Vue 3 + Tailwind CSS v4(SPA、`/api` を server へプロキシ)
> - `server`: Hono + Prisma(SQLite)+ Octokit + Docker CLI(独立APIサーバー、SSE / インプロセスジョブワーカー内蔵)
>
> 以降の本文にある技術選定(Next.js 等)は初期案。データモデル・プレビュー起動方式・
> API設計・段階的実装方針は引き続き有効。M1〜M3 + issue対応(公開API化 / Cloudflareトンネル /
> ファイル書き換え / 自動破棄)+ M6本番ビルド(web静的配信の単一プロセス + tsup)まで実装済み。

## 1. 目的・概要

GitHubと連携し、Pull Request(PR)ごとにエフェメラルなプレビュー環境(アプリ)を
ローカルのDocker上に自動構築するアプリケーション。
WebUIからPRを指定して、PR内容・diff・コメントを確認しつつ、ワンクリックで
プレビュー環境を起動・停止・破棄できる。

呼称: 本ドキュメントでは本アプリを **Orchestrator**、プレビュー対象となる
ユーザーのリポジトリを **Target Repository(対象リポジトリ)** と呼ぶ。

## 2. 確定済み要件(ユーザー合意済み)

| 項目 | 決定 |
| --- | --- |
| テスト環境の中身 | PRコードをチェックアウトしDockerでアプリを起動する**エフェメラルなプレビュー環境** |
| 実行基盤 | **Docker / Docker Compose(ローカル)** |
| 技術スタック | **TypeScriptフルスタック(Next.js)** |
| GitHub連携 | **GitHub App + Webhook** |

## 3. 機能要件

### 3.1 GitHub連携
- GitHub Appとしてインストールし、対象リポジトリへアクセス
- Webhook(`pull_request`, `issue_comment`, `pull_request_review`)を受信
- PRの open / synchronize(push) / closed イベントに反応

### 3.2 WebUI
- インストール済みリポジトリ一覧
- リポジトリのPR一覧(状態・作者・更新日時)
- PR詳細
  - タイトル・本文・ブランチ・作者・ラベル・状態
  - **diff表示**(ファイルごと、シンタックスハイライト付き)
  - **コメント表示**(issueコメント + レビューコメント + レビュー)
  - プレビュー環境の状態とアクセスURL、ビルドログ
- プレビュー環境の操作: 起動 / 再ビルド / 停止 / 破棄

### 3.3 プレビュー環境ライフサイクル
- PRのheadブランチをclone/fetch
- 対象リポジトリの`docker compose`でコンテナ群を起動(PRごとに一意なproject名)
- 動的ポート割り当て + リバースプロキシ経由でアクセス
- PRがpushされたら再ビルド、closeされたら自動破棄

## 4. 非機能要件・前提・制約

- ローカル自己完結(外部マネージドサービスに依存しない)。Redis等の追加ミドルウェアは最小限。
- 対象リポジトリは**プレビュー可能な構成**を持つことを前提とする:
  - リポジトリルート(または設定で指定したパス)に`docker-compose.yml`が存在する
  - 公開すべきWebサービスが1つ特定できる(設定でサービス名・内部ポートを指定)
- 同時に複数PRのプレビューが起動しうる → ポート競合・リソース管理が必要。
- ビルド(`docker compose build`)は長時間処理 → 非同期ジョブとして実行し、UIは進捗をポーリング/SSEで取得。
- セキュリティ: 対象リポジトリの任意コードをローカルDockerで実行するため、**信頼できるリポジトリのみ**を対象とする(MVPの明示的制約)。

## 5. アーキテクチャ

### 5.1 全体構成

```
                 ┌─────────────────────────────────────────────┐
   GitHub ──Webhook──▶  Next.js App (Orchestrator)              │
     ▲           │   ┌───────────────┐   ┌──────────────────┐  │
     │  Octokit  │   │ WebUI (React) │   │ Route Handlers   │  │
     └───────────┼──▶│ App Router    │◀─▶│ /api/* + webhook │  │
                 │   └───────────────┘   └────────┬─────────┘  │
                 │                                 │            │
                 │   ┌─────────────────────────────▼─────────┐ │
                 │   │ Orchestrator Core                      │ │
                 │   │  - GitHub service (Octokit)            │ │
                 │   │  - Preview service (clone/compose)     │ │
                 │   │  - Job queue (in-process worker)       │ │
                 │   └─────────┬───────────────────┬──────────┘ │
                 │             │ dockerode/CLI     │ Prisma     │
                 └─────────────┼───────────────────┼────────────┘
                               ▼                   ▼
                    Docker Engine          SQLite (state)
                    (Target containers)
                               │
                    Reverse Proxy (Traefik)
                       *.preview.localhost
```

### 5.2 技術選定

| レイヤ | 技術 | 理由 |
| --- | --- | --- |
| フレームワーク | Next.js 15 (App Router, TypeScript) | フロント/バック一体・SSR・Route Handlers |
| UI | React + Tailwind CSS + shadcn/ui | 一般的で開発が速い |
| diff表示 | `react-diff-view` または `diff2html` | PR diffの描画 |
| GitHub API | Octokit(`@octokit/app`,`@octokit/rest`,`@octokit/webhooks`) | GitHub App標準クライアント |
| Docker操作 | `dockerode` + `docker compose` CLI | コンテナ/コンポーズのライフサイクル管理 |
| 状態管理(DB) | SQLite + Prisma | ローカル自己完結・型安全 |
| ジョブ実行 | インプロセスワーカー(DBポーリング型キュー) | Redis不要・自己完結 |
| 進捗通知 | SSE(Server-Sent Events) | ビルドログ/状態のリアルタイム表示 |
| リバースプロキシ | Traefik(Docker provider) | PRごとのサブドメインルーティングを動的に |

> 補足: ジョブ実行はMVPではインプロセスワーカーで開始。将来的に負荷が増えれば
> BullMQ(Redis)へ差し替え可能なインターフェースにしておく。

### 5.3 プレビュー環境の起動方式

1. PRのhead(`owner/repo@sha`)を作業ディレクトリへ`git clone`(または既存をfetch+checkout)
2. PRごとに一意な識別子を採番: `preview-<repoSlug>-pr<number>`
3. `COMPOSE_PROJECT_NAME`にこの識別子を設定して`docker compose up -d --build`を実行
4. ルーティング: 生成した`docker-compose.override.yml`でTraefikのラベルを注入
   - `traefik.http.routers.<id>.rule=Host(\`<id>.preview.localhost\`)`
   - 共有Dockerネットワーク`orchestrator-proxy`へ対象Webサービスを参加させる
   - `*.preview.localhost`はブラウザが自動的に127.0.0.1へ解決(別途/etc/hosts不要)
5. 起動完了後、アクセスURL(`http://<id>.preview.localhost`)をDBに記録しUIへ表示

> Traefik導入が重い場合のフォールバック(MVP簡易版):
> override.ymlで対象Webサービスの内部ポートを**動的ホストポート**にマッピングし、
> `http://localhost:<port>`をUIに表示する。リバースプロキシは後追いで追加可能。
> → 初期実装は**簡易版(動的ホストポート)**から始め、Traefik対応を次段で追加する。

### 5.4 データモデル(Prisma 概略)

```prisma
model Repository {
  id            String   @id @default(cuid())
  owner         String
  name          String
  installationId Int
  // プレビュー設定
  composePath   String   @default("docker-compose.yml")
  webService    String?  // 公開するサービス名
  internalPort  Int?     // そのサービスの内部ポート
  pullRequests  PullRequest[]
  @@unique([owner, name])
}

model PullRequest {
  id           String   @id @default(cuid())
  repositoryId String
  number       Int
  title        String
  state        String   // open / closed / merged
  authorLogin  String
  headRef      String
  headSha      String
  baseRef      String
  updatedAt    DateTime
  preview      PreviewEnvironment?
  repository   Repository @relation(fields: [repositoryId], references: [id])
  @@unique([repositoryId, number])
}

model PreviewEnvironment {
  id            String   @id @default(cuid())
  pullRequestId String   @unique
  status        String   // pending/cloning/building/running/stopping/stopped/failed
  composeProject String
  url           String?
  hostPort      Int?
  commitSha     String
  logs          String   @default("")  // 直近ビルドログ(別テーブル化も検討)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  pullRequest   PullRequest @relation(fields: [pullRequestId], references: [id])
}

model Job {
  id        String   @id @default(cuid())
  type      String   // build / stop / destroy / sync
  payload   String   // JSON
  status    String   // queued / running / done / failed
  attempts  Int      @default(0)
  error     String?
  createdAt DateTime @default(now())
}
```

### 5.5 API / ルート設計(Next.js Route Handlers)

| メソッド | パス | 概要 |
| --- | --- | --- |
| POST | `/api/github/webhook` | GitHub Webhook受信(署名検証) |
| GET | `/api/repositories` | インストール済みリポジトリ一覧 |
| GET | `/api/repositories/:id/pulls` | PR一覧(GitHubから取得+キャッシュ) |
| GET | `/api/pulls/:id` | PR詳細(本文・diff・コメント) |
| GET | `/api/pulls/:id/diff` | PR diff取得 |
| POST | `/api/pulls/:id/preview` | プレビュー起動/再ビルド(ジョブ投入) |
| DELETE | `/api/pulls/:id/preview` | プレビュー破棄(ジョブ投入) |
| GET | `/api/preview/:id/events` | SSE: ステータス/ログのストリーム |
| PUT | `/api/repositories/:id/settings` | プレビュー設定(composePath等)更新 |

### 5.6 画面構成(App Router)

- `/` ダッシュボード(リポジトリ一覧 + 稼働中プレビュー一覧)
- `/repos/[owner]/[name]` PR一覧
- `/repos/[owner]/[name]/pull/[number]` PR詳細(diff/コメント/プレビュー操作)
- `/repos/[owner]/[name]/settings` プレビュー設定
- `/settings` GitHub App接続設定

## 6. ディレクトリ構成(案)

```
git_review/
├─ src/
│  ├─ app/                    # Next.js App Router(画面 + route handlers)
│  │  ├─ api/
│  │  ├─ repos/
│  │  └─ ...
│  ├─ server/                 # サーバーサイドのコアロジック
│  │  ├─ github/              # Octokitラッパ・webhook処理
│  │  ├─ preview/             # clone・compose・docker操作
│  │  ├─ jobs/                # ジョブキュー・ワーカー
│  │  └─ db/                  # Prismaクライアント
│  ├─ components/             # UIコンポーネント
│  └─ lib/                    # 汎用ユーティリティ
├─ prisma/
│  └─ schema.prisma
├─ workspaces/                # 対象リポジトリのclone先(gitignore)
├─ docker-compose.yml         # Orchestrator自身 + Traefik(任意)
├─ .env.example
└─ package.json
```

## 7. 段階的実装方針(マイルストーン)

- **M1: 基盤** Next.js + Prisma + Tailwind雛形、DBスキーマ、設定画面
- **M2: GitHub連携(読み取り)** GitHub App認証、リポジトリ/PR/diff/コメント取得とWebUI表示
- **M3: プレビュー起動(簡易版)** clone + compose up(動的ホストポート)、状態管理、ログSSE
- **M4: Webhook自動化** PRイベントで自動ビルド/破棄
- **M5: Traefik対応** サブドメインルーティング、複数PR同時稼働の安定化
- **M6: 仕上げ** エラーハンドリング、クリーンアップ、ドキュメント

## 8. 未決定事項・要確認(実装前に詰める)

1. プレビュー対象は単一リポジトリ運用か、複数リポジトリ対応か(初期は複数対応の構造だが運用は1つでも可)
2. GitHub Appはユーザーが新規作成する想定でよいか(作成手順をREADMEに記載)
3. プレビュー環境の認証/アクセス制御は不要か(ローカル前提なので初期は無し)
4. ビルドログの保持期間・保存方式(DB直書き vs ファイル)
5. 同時起動数の上限・リソース制限の要否
