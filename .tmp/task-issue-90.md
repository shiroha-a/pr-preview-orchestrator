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
