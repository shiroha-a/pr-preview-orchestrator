# issue #90: 本体をDockerで動かせるようにする

## 1. 背景・要件

issueの内容:

> このアプリケーション自体をDockerで動かせるように
> プレビュー環境を動作させるDockerはホスト側のものを使う
> バインドマウントで/var/run/docker.sockを食わせて操作

つまり **Docker-out-of-Docker(DooD)** 構成。オーケストレーター(本体)をコンテナで動かし、
プレビュー環境のコンテナは**ホストのdockerデーモン**上に作る。DinD(コンテナ内デーモン)は使わない。

### 前提の確認(現状コード)

- 本体が外部プロセスとして起動するのは `docker` と `git` の2つだけ
  (`server/src/preview/service.ts`、`docker/run.ts`、`preview/tunnel.ts`、`preview/volumes.ts`、`routes/metrics.ts`)。
  → イメージにdocker CLI + composeプラグイン + gitを同梱すればよい。
- Cloudflare Quick Tunnelは`cloudflare/cloudflared`イメージの**独立コンテナ**(`--network host`)として起動する(issue #48)。
  → 本体イメージに`cloudflared`バイナリは不要。ホストデーモン側でhostネットワークに繋がるため、
    コンテナ内から起動してもプレビューの`localhost:<port>`に到達できる。
- プレビューへのHTTPプローブは行っていない。本体からプレビューへの直接通信は無い。
- 永続化が必要なのは SQLite(`DATABASE_URL`)と clone先(`WORKSPACES_DIR`)のみ。

## 2. DooDで壊れる箇所と対策

### 2.1 対象リポジトリのbind mountのパス不一致(最重要)

`docker compose`は**CLI側で**bind mountの相対パスを絶対パスへ解決し、その文字列をデーモンへ渡す。
本体をコンテナ化するとCLIはコンテナ内で動くため、`./config:/app/config`のようなマウントは
コンテナ内パス(例`/data/workspaces/foo/config`)に解決され、**ホスト側にそのパスが無い**と
デーモンが空ディレクトリを作ってしまい、サイレントに壊れる。

対策: **ホストとコンテナで同一の絶対パスにデータディレクトリをマウントする**。

```
volumes:
  - "${DATA_DIR}:${DATA_DIR}"   # 例: /srv/pr-preview:/srv/pr-preview
environment:
  WORKSPACES_DIR: "${DATA_DIR}/workspaces"
  DATABASE_URL: "file:${DATA_DIR}/app.db"
```

これによりcloneしたワークスペースのパスがホストと一致し、対象リポジトリの
`docker-compose.yml`をそのまま使える(READMEの既存の売り文句を維持できる)。
`DATA_DIR`は**絶対パス必須**(相対パスはコンテナ側マウント先として不正)。

### 2.2 ホストポートの空き判定が効かない

`preview/ports.ts`の`isPortFree()`は`net.createServer().listen(port)`で判定するが、
コンテナのネットワーク名前空間で bind するため**ホストの使用状況を反映しない**。
その結果`docker compose up`が`port is already allocated`で失敗し得る。

対策: ホストデーモンに問い合わせて**公開済みホストポート**を取得し、DB上の使用済みポートと
併せて除外する。`docker ps --format "{{.Ports}}"`の出力を解析する(範囲公開`13000-13005->`にも対応)。

- 新規: `server/src/docker/ports.ts`
  - `parsePublishedPorts(lines: string[]): Set<number>`(純関数、テスト対象)
  - `listPublishedHostPorts(): Promise<Set<number>>`(docker CLI呼び出し、失敗時は空集合=best-effort)
- `allocateHostPort()`で1回だけ取得し、ループ内の判定に使う。
- ベアメタル運用でも「本体が知らないコンテナが掴んでいるポート」を避けられるため、常時有効にする。
- 残る制約: コンテナ運用時、**docker以外のホストプロセス**が範囲内のポートを掴んでいる場合は
  検出できない。READMEに明記し、必要ならポート範囲を狭める運用とする。

### 2.3 ディスク使用量メトリクスがコンテナのFSを指す

`routes/metrics.ts`は`statfs("/")`。コンテナ内ではoverlayfs(=イメージ層)の値になり無意味。

対策: `METRICS_DISK_PATH`(既定`/`)を追加し、compose では`${DATA_DIR}`を指定する。
データ・workspace・`/var/lib/docker`が同一ディスクにある一般的な構成なら実用的な値になる。

メモリ/スワップ/loadavgは`os.totalmem()`・`/proc/meminfo`ともホストの値が見えるため変更不要。

### 2.4 シグナル・ゾンビ

- 起動を`sh -c "... && npm run start"`にすると`docker stop`のSIGTERMがnodeまで届かず10秒後にSIGKILLされる。
  → entrypointスクリプトで**`exec node dist/index.js`**する。
- docker CLIの孫プロセスがPID1に再parentされるとゾンビが残り得るため、composeで`init: true`(tini)。

## 3. 成果物

| ファイル | 内容 |
| --- | --- |
| `Dockerfile` | node:26-trixie-slim + docker CLI + composeプラグイン + git。web/serverビルド後にdevDeps削除 |
| `scripts/docker-entrypoint.sh` | `prisma migrate deploy`後に`exec node dist/index.js` |
| `.dockerignore` | node_modules/dist/.git/workspaces/*.db/.env を除外 |
| `docker-compose.yml` | 本体を動かすcompose。docker.sock + `${DATA_DIR}`同一パスマウント |
| `.env.example`(リポジトリ直下) | compose用の変数(`DATA_DIR`・`APP_PORT`・各種設定) |
| `server/src/docker/ports.ts` | 公開ホストポートの取得(新規) |
| `server/src/preview/ports.ts` | 上記を空きポート判定に組み込み |
| `server/src/env.ts` / `server/.env.example` | `METRICS_DISK_PATH`追加 |
| `server/src/routes/metrics.ts` | statfs対象を`METRICS_DISK_PATH`に |
| `server/test/docker/ports.test.ts` | ポート解析のユニットテスト(新規) |
| `README.md` | Docker運用手順・注意点・環境変数表の更新 |
| `.github/workflows/ci.yml` | イメージビルドの検証ジョブを追加 |

### Dockerfileの方針

- ベースは`node:26-trixie-slim`。Docker aptリポジトリのコードネームは`/etc/os-release`から動的取得
  (ベース更新時の書き換え漏れ防止)。
- 依存インストール(`npm ci --include=dev`)をソースコピーと分離してレイヤーキャッシュを効かせる。
  `postinstall`の`prisma generate`が必要とする`prisma/`と`prisma.config.ts`は先にコピーする。
- ビルド後に`npm prune --omit=dev`でdevDeps(vite/vue-tsc/tsup/tsx等)を削除。
  `prisma` CLIは`dependencies`側なのでマイグレーションは実行可能。
- 実行ユーザーはroot(docker.sockのgidがホスト依存のため)。セキュリティ上の注意はREADMEに記載。

### 環境変数(compose)

`docker compose`はcomposeファイルと同じディレクトリの`.env`を**変数展開用**に自動で読む。
`env_file`は使わず`environment:`で明示マッピングし、既定値付き展開(`${VAR:-default}`)にする。

## 4. 非対象(スコープ外)

- イメージのレジストリ公開(GHCR等)。ローカル`build: .`で運用する。
- DinD構成・rootlessモード対応。
- 本体コンテナからプレビューへの疎通確認(現状も未実装)。

---

## 5. PR #91 レビュー対応(2026-08-24)

### 指摘1: ディスク使用量の既定は`/var/lib/docker`が良い

`METRICS_DISK_PATH`の既定を`/`から**`/var/lib/docker`**(dockerのデータルート)へ変更した。
実際に逼迫するのはイメージ・ビルドキャッシュ・ボリュームが載るこのパスであるため。

- 取得に失敗した場合は`/`へフォールバックする(rootlessやマウント無しでも0表示にならない)。
- composeは`${DOCKER_ROOT_DIR:-/var/lib/docker}`を**読み取り専用**でマウントする(`statfs`にのみ使用)。

### 指摘2: トンネル公開なら外部ポートは不要。トンネルを必須要件にして単純化する

プレビューの公開を**Cloudflare Quick Tunnel経由のみ**にし、ホストポートの割り当て・公開を全廃した。
これにより issue #90 で問題になっていた「コンテナ内からホストのポート空き状況が分からない」問題自体が
消滅する(2.2で追加したポート走査も不要になり削除)。

**方式**: トンネルのコンテナをプレビューのcomposeネットワークに参加させ、composeのサービス名で
originへ到達する(`http://<webService>:<internalPort>`)。

順序の制約と解法:

- URLはファイル書き換え/オーバーレイに注入するため`compose up`より**前**に確定させる必要がある。
- 一方、参加すべきネットワークは`compose up`が作るまで存在しない。
- → トンネルは既定のbridge(外向き通信が可能)で起動してURLを確定させ、`up`の後に
  `docker network connect`で接続する。cloudflaredはoriginのDNSをリクエスト時に解決するため、
  起動時点でサービスが存在しなくてよい。
- `compose down`の前に`docker network disconnect`する。繋がったままだとネットワークを削除できない。

**廃止したもの**: `PREVIEW_HOST` / `PREVIEW_PORT_MIN` / `PREVIEW_PORT_MAX` / `PREVIEW_TUNNEL`(常時有効)、
`PreviewEnvironment.hostPort`列、`{{HOST_PORT}}`テンプレート変数、`preview/ports.ts`・`docker/ports.ts`。

**compose override**: 従来の`ports: !override ["<hostPort>:<internalPort>"]`を
`ports: !override []`に変更。対象リポジトリの固定ポート定義を空にするので、同一リポジトリの
複数プレビューを同時起動してもホスト側で衝突しない。

**トレードオフ(仕様変更)**:

- トンネルの確立に失敗するとプレビューへの到達手段が無いため、ビルドは失敗する(フォールバック無し)。
- `PREVIEW_TUNNEL=false`によるLAN内利用はできなくなる。
- 公開Webサービスが`network_mode: host`の場合はサービス名で解決できないため利用できない。
- `{{HOST_PORT}}`を使っている既存のリポジトリ設定は展開されなくなる。
