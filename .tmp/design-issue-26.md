# 設計: issue #26 Markdown表示

`feat/issue-26-markdown`ブランチ(最新mainから)。

## 目的
PRコメント(issue本文)と、追加要望でPR本文のMarkdownを描画する。現状はどちらも
プレーンテキスト(`whitespace-pre-wrap`)表示。

## 方針
- 依存追加(web):
  - `marked`(GFM→HTML変換、runtime dep)
  - `dompurify`(サニタイズ。GitHub由来の本文/コメントは未信頼のためXSS対策必須、runtime dep)
  - `@tailwindcss/typography`(`prose`整形、devDep)
- Tailwind v4: `web/src/style.css`に`@plugin "@tailwindcss/typography";`を追加。
- 再利用可能な`MarkdownView.vue`を新規作成:
  - `marked.parse(src, { async: false })` → `DOMPurify.sanitize()` → `v-html`
  - `gfm: true`, `breaks: true`(GitHubのコメント改行挙動に合わせる)
  - DOMPurifyフックでaタグに`target=_blank rel="noopener noreferrer"`を付与
  - `prose prose-sm dark:prose-invert max-w-none break-words`でスタイル
- 適用:
  - `PullDetailView.vue`: PR本文(`cleanBody`、HTMLコメント除去済み)を`MarkdownView`で描画
  - `CommentList.vue`: コメント本文を`MarkdownView`で描画

## 注意
- 未信頼コンテンツのため必ずDOMPurifyでサニタイズしてからv-htmlする。
- 依存追加時のlockfile汚染を避けるため`NODE_ENV=development`でinstall(omit=devを無効化)。

## 確認
- `npm run typecheck` / `npm run build -w web`(typographyプラグイン動作)/ `npm test`(Node 24で全27パス)/ `npm run format`
