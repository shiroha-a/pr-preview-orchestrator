# タスク: issue #90 本体をDockerで動かせるようにする

設計書: `.tmp/design-issue-90.md`
ブランチ: `feature/dockerize-app`(`origin/main`から作成)

## 1. コンテナ化の基盤
- [x] `.dockerignore`を追加
- [x] `Dockerfile`を追加(docker CLI + composeプラグイン + git同梱、web/serverビルド、devDeps削除)
- [x] `scripts/docker-entrypoint.sh`を追加(migrate deploy → exec node)
- [x] `docker-compose.yml`を追加(docker.sockマウント、`${DATA_DIR}`同一パスマウント、init: true)
- [x] リポジトリ直下に`.env.example`(compose用)を追加

## 2. DooDで壊れる箇所の修正
- [x] `server/src/docker/ports.ts`: `docker ps`から公開ホストポートを取得(範囲公開対応)
- [x] `server/src/preview/ports.ts`: 空きポート判定に公開ポート集合を組み込み
- [x] `server/src/env.ts` + `server/.env.example`: `METRICS_DISK_PATH`を追加
- [x] `server/src/routes/metrics.ts`: statfs対象を`METRICS_DISK_PATH`に変更

## 3. テスト
- [x] `server/test/docker/ports.test.ts`(公開ポート解析のユニットテスト)
- [x] `npm run typecheck` / `npm run test -w server`が通ること
- [x] `prettier --write`でフォーマット

## 4. 実機確認
- [x] `docker build`が通る(イメージ内のdocker CLI / compose / git / node のバージョン確認)
- [x] コンテナ起動 → マイグレーション適用 → `/api/health`が200
- [x] コンテナ内からホストのdockerデーモンを操作できる(`docker ps`)
- [x] WebUIが同一ポートで配信される
- [x] `docker stop`でSIGTERMが届き即時停止する(0.28秒 / exit 143)
- [x] コンテナ内の`docker compose`で相対パスのbind mountを持つプロジェクトを起動し、
      ホスト側の実ファイルが見えること(パス一致の検証)+ `compose build`も成功すること
- [x] ホストの公開ポートを`listPublishedHostPorts()`が検出できること
- [x] 後片付け(テスト用コンテナ・イメージ・データディレクトリの削除)

## 5. ドキュメント・CI
- [x] README: Docker運用手順・注意点(パス一致・ポート範囲・セキュリティ)・環境変数表を更新
- [x] `.github/workflows/ci.yml`: イメージビルド検証ジョブを追加

## 6. PR #91 レビュー対応
- [x] 指摘1: `METRICS_DISK_PATH`の既定を`/var/lib/docker`へ(失敗時は`/`へフォールバック)
- [x] 指摘1: composeでdockerデータルートを読み取り専用マウント(`DOCKER_ROOT_DIR`)
- [x] 指摘2: `tunnel.ts`に`connectTunnel`/`disconnectTunnel`を追加、`startTunnel`はorigin URLを受け取る
- [x] 指摘2: `service.ts`のbuild/restart/reattachをトンネル前提に変更(up後に接続、down前に切断)
- [x] 指摘2: composeのoverrideを`ports: !override []`に変更
- [x] 指摘2: `preview/ports.ts`・`docker/ports.ts`・そのテストを削除
- [x] 指摘2: `PREVIEW_HOST`/`PREVIEW_PORT_MIN`/`PREVIEW_PORT_MAX`/`PREVIEW_TUNNEL`を廃止
- [x] 指摘2: `hostPort`列の削除マイグレーション(`20260823152601_remove_preview_host_port`)
- [x] 指摘2: WebUI(型・設定画面・テンプレート変数の説明)を更新
- [x] `renderOverride`のユニットテストを追加(テスト84件パス)
- [x] 実コードでのトンネルE2E(URL先行確定 → up → connect → 公開URLで200 → disconnect → down)
- [x] README・`.env.example`(直下/server)・`docker-compose.yml`の更新
