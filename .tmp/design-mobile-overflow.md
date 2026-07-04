# モバイルでの横はみ出し修正(ダッシュボードのプレビューカード/PRコメントのマークダウン)

## 問題

モバイル幅で2箇所、コンテンツがビューポート幅を超えてページ全体が横スクロールできてしまう。

1. ダッシュボードの「稼働中のプレビュー」カードがページ横幅を超える
2. PR詳細ページで、コメント・説明のマークダウン(テーブル等)がページ横幅をはみ出す

## 原因

1. `DashboardView.vue` のカードは `grid` 直下の `BaseCard`(および `RouterLink`)が
   グリッドアイテムになるが、`min-w-0` がないためアイテムの自動最小幅
   (`min-width:auto` = min-content)が適用される。カード内の `truncate`
   (`white-space:nowrap`)なタイトル/サブタイトルの1行全幅が min-content を
   押し広げ、モバイルの1カラムがビューポート幅を超える
   (スクリーンショットで長いサブタイトルが省略されず1行表示されていることから確認)。
2. `MarkdownView.vue` の `.prose` 内の `<table>` は幅を内容に合わせて広げるため、
   ビューポートより広いテーブルがページごと押し広げる。コードブロック(`pre`)は
   typographyプラグインが `overflow-x:auto` を当てるがテーブルには対策がない。

## 対応方針

1. `DashboardView.vue`
   - プレビューカードの `BaseCard`、リポジトリカードの `RouterLink` に `min-w-0` を付与
     (グリッドアイテムの自動最小幅を無効化し、`truncate` を機能させる)
   - プレビューURLは `break-all` の `span` で包み、アイコンに `shrink-0` を付与
     (ハイフンを含まない長いURLでもカード内で折り返す)
2. `MarkdownView.vue`
   - GitHub本家のmarkdown CSSと同じ方式でテーブルを封じ込める:
     `table { display:block; width:max-content; max-width:100%; overflow-x:auto }`
   - `v-html` 描画のため scoped style + `:deep(table)` で適用。
     PR本文(説明)とコメントの両方が同コンポーネントのため1箇所で解決

## 対象外

- `SettingsView.vue` のグリッドはフォーム項目のみで nowrap な長文がなく影響なし
- `SystemMetrics.vue` のプレビュー一覧は flex 内の `truncate`(overflow:hidden)で
  自動最小幅が0になるため影響なし
- DiffView(diff2html)は報告対象外のため触らない

## テスト

- `npm run typecheck`(server tsc + web vue-tsc)
- ブラウザのモバイル幅(390px前後)でダッシュボード/PR詳細を目視確認(手動)
