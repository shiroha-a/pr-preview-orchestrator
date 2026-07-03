# issue #56: プロファイルのオーバーレイファイルを置換ではなく追加にする

## 背景

- #53(issue #52)ではプロファイルの`overlayFiles`は「非null=丸ごと置換」だった。
- 要望: 既定のオーバーレイファイルを使いつつ、プロファイルでファイルを追加したい。
  既定のファイルを配置したくない場合は明示的に削除指定する。

## 仕様

- プロファイルの`overlayFiles`(JSON配列)のエントリを次の2種にする:
  - `{ path, content }` — 追加。既定に同じpathがあれば内容を上書き。
  - `{ path, delete: true }` — 既定の同pathのファイルをこのプロファイルでは配置しない。
- 実効オーバーレイ = 既定のオーバーレイにプロファイルのエントリを順に適用したもの
  (Mapで path をキーにマージ。既存キーの置換は元の位置を維持、新規は末尾に追加)。
- `overlayFiles`がnullのプロファイルは従来どおり既定をそのまま継承。
- fileRewritesは対象外(従来どおり置換)。issueの要望はオーバーレイのみ。

## 実装

- `preview/overlay.ts`: `ProfileOverlayEntry`型 + `parseProfileOverlayEntries()` を追加。
- `preview/settings.ts`: `mergeOverlayFiles()` を追加。`EffectiveSettings.overlayFiles`を
  パース済みの`OverlayFile[]`に変更し、resolveSettings内でマージまで済ませる。
- `preview/service.ts`: `parseOverlayFiles`呼び出しを削除し`settings.overlayFiles`を直接使用。
- `routes/repositories.ts`: プロファイルの`overlayFiles`スキーマを
  `{ path, content?, delete? }` に変更。
- Web:
  - プロファイルのオーバーレイ欄を「追加・削除」UIに変更:
    - 既定ファイルのパス一覧に「配置しない」チェックボックス(=deleteエントリ)。
    - 追加/上書きファイルのエディタ(従来のOverlayFilesEditor)。
  - フォーム状態を `overlays`(追加分)+ `deletePaths`(削除指定)に分離。
    新規プロファイル作成時の既定コピーのプリフィルは廃止(追加方式では不要)。

## 互換性の注意

- 既存プロファイルの`overlayFiles`(置換リスト)は追加扱いに変わる。同じpathは
  内容上書きなので多くは同挙動だが、「既定のファイルを外す」意図で置換していた
  場合は明示的な削除指定への修正が必要(UIで削除チェックを付ける)。

## テスト

- settings.test.ts: mergeOverlayFilesの単体テスト(追加/同path上書き/削除/順序)と
  resolveSettingsのオーバーレイ解決テストを更新。
- routes/settings.test.ts: deleteエントリを含むプロファイルの保存テストを追加。

## テスト基盤の修正(実行順依存の解消)

作業中に routes/settings.test.ts が実行順によって全滅する問題が発覚した(#54時点の潜在バグ)。

- 原因: vitestが `isolate: false`(1ワーカー・モジュールキャッシュ共有)のため、
  users.test.ts が先に `src/db/client` をimportするとグローバルprismaが `dev.db`
  向きでキャッシュされ、routes/settings.test.ts のimport前環境変数上書きが無効化される。
  実行順は前回実行時間で変わるため不安定に再現。
- 修正:
  - vitest.config.ts の `test.env.DATABASE_URL` で全テストファイル共通に
    テストDB(`test.vitest.db`)へ固定(どのファイルが最初にimportしても同じ)。
  - 共有テストDBは実行中に削除しない(`prepareSharedTestDb` = migrate deployのみ。
    削除すると接続済みハンドルがstale inodeを掴む)。データ掃除はtruncateAll。
  - migrate.test.ts はファイル削除が必要なため専用DB(`test.migrate.db`)に分離。
- `--sequence.shuffle.files=true` で順序シャッフルしても安定することを確認済み。
