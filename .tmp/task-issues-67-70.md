# タスク一覧: Dockerディスク管理の改善 (issue #67〜#70)

設計書: `.tmp/design-issues-67-70.md`
方針: issue毎に4つのPRへ分割し、順にスカッシュマージする。

## PR1: Dockerディスク使用状況の表示 (issue #68) — feature/docker-df

- [x] server: `docker/run.ts`(CLIランナー)と`docker/df.ts`(system dfパース+キャッシュ)
- [x] server: `routes/docker.ts`(GET /df)+app.tsマウント
- [x] web: types/client/SystemMetrics.vue にDocker使用状況セクション
- [x] テスト: parseDockerSize / parseSystemDf

## PR2: ビルドキャッシュ削除の非同期化 (issue #70) — feature/async-cleanup-state

- [x] server: `docker/cleanup.ts`(サーバー側状態機械。builder prune)
- [x] server: GET /cleanup, POST /cleanup/builder-prune。旧同期 `/preview/builder-prune` を削除
- [x] web: マウント時の状態復元+実行中ポーリング(リロード耐性)

## PR3: ビルドキャッシュの全削除オプション (issue #69) — feature/builder-prune-all

- [x] server: `docker builder prune -a` の all オプション(既定ON)
- [x] web: 「最近使用分も含めて全削除」チェックボックス

## PR4: 破棄済みプレビューの不要イメージ削除 (issue #67) — feature/orphan-image-cleanup

- [x] server: `destroyPreview` に `--rmi local` 追加
- [x] server: `docker/images.ts`+`startImagePrune`(preview-\*ラベル限定+dangling prune)
- [x] web: 「不要イメージを削除」ボタン
- [x] テスト: parseImageInspectLines / selectOrphanImages / imageRemovalRefs

## 共通

- [x] format + typecheck + test + 実サーバーでGET動作確認(df/cleanup/キャッシュ)
- [x] README更新(主な機能・自動破棄の説明)
