# issue #75: テンプレート変数にPR情報(PR_TITLE / PR_NUMBER / PROFILE_NAME)を追加

## 背景

ファイル書き換えルールとオーバーレイファイルでは、`{{PREVIEW_URL}}` / `{{PREVIEW_HOST}}` /
`{{HOST_PORT}}` のテンプレート変数を展開できる(`server/src/preview/service.ts` の
`templateVars` → `applyOverlays` / `applyRewrites` → `expandTemplate`)。

issue #75 では同じ仕組みで以下が欲しいと要望されている:

- PRタイトル(ブランチプレビューではブランチ名)
- PR番号(ブランチプレビューではブランチ名)
- プロファイル名

プレビュー先アプリのインスタンス名やバナー文言等にPR情報を注入する用途を想定。

## 要件

新しいテンプレート変数を追加する。展開箇所は既存と同じ(書き換えルールの置換文字列・
オーバーレイファイルの内容)。

| 変数 | PRプレビュー | ブランチプレビュー |
| --- | --- | --- |
| `{{PR_NUMBER}}` | PR番号(例: `123`) | ブランチ名 |
| `{{PR_TITLE}}` | PRタイトル | ブランチ名 |
| `{{PROFILE_NAME}}` | 使用プロファイル名。既定設定(プロファイルなし)では空文字 | 同左 |

- PRタイトル・番号はDBにキャッシュ済みの `PullRequest`(`title` / `number`)から取得。
- プロファイル名は `PreviewEnvironment.profile`(`SettingsProfile.name`)。null時は空文字。
- 値はエスケープしない(既存変数と同じ扱い)。YAML等への埋め込み時の引用は利用者の責任。

## 設計

- `server/src/preview/service.ts`
  - `BuildTarget` に `templateVars: Record<string, string>` を追加し、
    `resolveBuildTarget()` がPR/ブランチの分岐内で静的な変数(PR_NUMBER / PR_TITLE /
    PROFILE_NAME)を組み立てる。
  - `buildPreview()` の `templateVars` 構築時に `...target.templateVars` をマージする
    (PREVIEW_URL等の動的変数はビルド中にしか決まらないため従来どおりその場で追加)。
  - テストのため `resolveBuildTarget` を export する。
- ドキュメント更新
  - `README.md` の高度な設定セクションに新変数を追記。
  - `overlay.ts` / `rewrite.ts` のJSDocの変数列挙を更新。
- テスト: `server/test/preview/service.test.ts` を新規作成し、`resolveBuildTarget` が
  返す `templateVars` を検証する(PR/ブランチ×プロファイル有無)。

## 対象外

- docker compose プロセスへの環境変数としての注入(要望はテンプレート変数)。
- `BRANCH_NAME` 等の追加変数(要望の3つに限定)。
