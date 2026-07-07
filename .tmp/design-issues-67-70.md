# Dockerディスク管理の改善 (issue #67, #68, #69, #70)

## 背景

- 実機のdocker system df: イメージ902件/193.5GB(うちdangling 803件)、ビルドキャッシュ4611件/176GB。
- ホストにはプレビュー以外のcomposeプロジェクト(ai/mk/nekonoverse等)が共存しているため、
  クリーンアップは「preview-*プロジェクト由来」への限定が必須。

## 対象issue

| issue | 内容                                   | 対応方針                                                            |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| #67   | 破棄したプレビューのイメージが残る     | destroy時に`--rmi local`を付与+「不要イメージの削除」操作を追加     |
| #68   | docker system df相当の表示             | `/api/docker/df`を追加しダッシュボードに表示                        |
| #69   | 最近使ったビルドキャッシュが残る       | builder pruneに`-a`(全削除)オプションを追加(既定ON)                 |
| #70   | 削除中にリロードすると状態を見失う     | クリーンアップをサーバー側状態(非同期)にし、状態APIをポーリング     |

## サーバー設計

### 新規モジュール `server/src/docker/`

- `run.ts`: docker CLIを実行し出力行を収集する小さなランナー(アイドルタイムアウト付き)。
  volumes.tsのrunDockerと同様の局所ヘルパー。クリーンアップは長時間かかるためアイドル30分。
- `df.ts`: `docker system df --format '{{json .}}'`を実行し4行(Images/Containers/Local
  Volumes/Build Cache)をパース。
  - 純関数 `parseSystemDf(lines)` をエクスポート(テスト対象)。サイズ文字列("176GB",
    "930.5kB", "78.14GB (40%)")をバイト数に変換。
  - 15秒TTLのキャッシュ+実行中の重複起動防止(in-flight dedup)。`refresh`指定でTTL無視。
- `cleanup.ts`: グローバルなクリーンアップ操作の状態機械。
  - 状態: `{ running: { kind, startedAt } | null, last: { kind, ok, summary, error,
    finishedAt } | null }`(インメモリ。ページリロードには耐える。サーバー再起動で消えるのは許容)。
  - 同時実行は全kind共通で1つ(single-flight)。実行中の開始要求は409。
  - kind `builder-prune`: `docker builder prune -f [-a]`(issue #69: allオプション)。
  - kind `image-prune`(issue #67):
    1. 全イメージを`docker image inspect`し、`com.docker.compose.project`ラベルが
       `preview-`で始まり、かつアクティブなプレビュー(status ∉ {stopped, idle, failed})の
       composeProjectに該当しないイメージを非強制`docker rmi`で削除
       (使用中はdockerが拒否するので安全側)。タグ付きはタグ毎に、タグ無しはIDで削除。
    2. `docker image prune -f`でdanglingイメージを削除(ホスト全体。再ビルドの残骸が主対象)。
  - 純関数 `selectOrphanImages(images, activeProjects)` をエクスポート(テスト対象)。
  - 完了時にdfキャッシュを無効化。

### ルート `server/src/routes/docker.ts`(`/api/docker`にマウント)

- `GET /df` → `{ rows: [{ type, totalCount, active, sizeBytes, reclaimableBytes }], fetchedAt }`
  - type: `images | containers | volumes | buildCache`
- `GET /cleanup` → 上記のクリーンアップ状態
- `POST /cleanup/builder-prune` body `{ all?: boolean }` → `{ status }`(実行中なら409)
- `POST /cleanup/images` → `{ status }`(実行中なら409)

### 既存コードの変更

- `service.ts destroyPreview`: 2箇所の`docker compose down -v --remove-orphans`に
  `--rmi local`を追加(compose既定名のビルド済みイメージを破棄時に削除。issue #67)。
  `image:`指定の共有名イメージは対象外(複数プレビューで共有されうるため安全側)。
  restart/stopは変更しない。
- `service.ts pruneBuilderCache`と`POST /api/preview/builder-prune`は削除し、
  新しい`/api/docker/cleanup/*`へ移行(クライアントは同一リポジトリ内のみ)。

## フロントエンド設計 (SystemMetrics.vue)

- 「Docker」セクションを追加: イメージ/コンテナ/ボリューム/ビルドキャッシュの4行に
  件数(使用中)・サイズ・回収可能を表示(issue #68)。マウント時+30秒間隔+クリーンアップ完了後に取得。
- クリーンアップUI:
  - 「ビルドキャッシュを削除」ボタン+チェックボックス「最近使用したキャッシュも含めて削除」
    (既定ON=`-a`。issue #69)。
  - 「不要イメージを削除」ボタン(破棄済みプレビューのイメージ+danglingイメージ。issue #67)。
  - どちらも確認ダイアログでホスト全体への影響を明示。
- リロード耐性(issue #70): マウント時に`GET /cleanup`を取得し、実行中なら該当ボタンを
  「削除中...」表示にして2.5秒間隔でポーリング。完了で結果サマリ表示+df再取得。
  実行結果はサーバー側の`last`から復元されるため、リロードや別タブでも状態が一致する。

## テスト

- `server/test/docker/df.test.ts`: parseSystemDfのパース(実出力サンプル、単位混在、
  "(40%)"付きreclaimable、欠損行)。
- `server/test/docker/cleanup.test.ts`: selectOrphanImages(preview-\*プレフィクス限定、
  アクティブプロジェクト除外、タグ有無、他プロジェクトのラベル除外)。

## 変更しないこと

- ジョブキュー(worker.ts)はpreviewId前提のため使わない(クリーンアップは専用の状態機械)。
- `docker image prune -a`のような未使用イメージ全削除(共存プロジェクトのベースイメージまで
  消えるため対象外)。
