# issue #65: 変更差分の表示を別ページに分離

## 問題

PR詳細ページは変更差分(diff2html)をインライン描画しており、大きなdiffでは
DOMが巨大になる。プレビューのログをSSEで見ている間もこの重いDOMが同居する
ため、ページ全体が重くなる(issueの「ログを見てるときに重いため」)。

## 対応方針

変更差分を専用ページに分離し、PR詳細ページからはリンクで遷移する。

### ルーティング

- 新ルート: `/repos/:owner/:name/pull/:number/diff`(name: `pull-diff`)
  → 新規 `views/PullDiffView.vue`(lazy import。diff2htmlのバンドルも
  差分ページを開くまで読み込まれなくなる)

### PullDiffView.vue(新規)

- PR詳細ページへの戻りリンク+PRタイトル(`api.getPull`のキャッシュから取得。
  失敗しても差分表示には支障がないため無視)
- 「更新」ボタン: 差分のみ `?refresh=1` で再取得
- `DiffView`(diff2html)をBaseCardで表示。読み込み失敗時はエラーを表示
  (従来は握りつぶして「差分がありません」になっていたが、専用ページでは明示)

### PullDetailView.vue

- diff関連(state / loadDiff / DiffViewインポート)を削除
- 「変更差分」セクションはdiffページへのリンクボタンに置き換え
- 「更新」ボタンの対象からdiffを除外(diffの更新は差分ページ側で行う)

## 効果

- PR詳細ページはプレビューパネル+説明+コメントのみになり、ログ閲覧中の
  ページが軽くなる
- diff2html(+CSS)のチャンクは差分ページを開いたときだけロードされる

## テスト

- `npm run typecheck` / `npm run build -w web` / `npm run test -w server`(回帰)
- 手動: PR詳細→「変更差分を表示」→差分ページ表示・更新・戻りの動線
