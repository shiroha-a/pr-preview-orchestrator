# 設計: issue #30 PRステータスでフィルタ

`feat/issue-30-pr-filter`ブランチ(最新mainから)。

## 目的
PR一覧を Open / Draft / Closed / Merged でフィルタしたい(ドロップダウンまたはタブ)。

## 方針(フロントのみ)
PRデータには既に `state`(open/closed/merged)と `draft`(boolean)があるため、
サーバー変更は不要。`RepoPullsView.vue` でクライアント側フィルタを実装する。

- タブ切り替え(件数バッジ付き)で実装。フィルタ: すべて / Open / Draft / Closed / Merged。
- 判定(`matchesFilter`):
  - open: `state === "open" && !draft`(Draftはopen扱いのGitHub仕様だが別カテゴリにする)
  - draft: `draft`
  - closed: `state === "closed"`
  - merged: `state === "merged"`
  - all: すべて
- `counts`(各カテゴリ件数)と `filteredPulls`(選択フィルタで絞り込み)を computed で算出。
- 該当0件時は「このフィルタに該当するPRはありません。」を表示。

## 確認
- `npm run typecheck` / `npm run build -w web` / `npm run format`
