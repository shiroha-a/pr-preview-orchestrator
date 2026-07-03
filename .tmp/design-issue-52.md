# issue #52: 複数composeファイル指定とプロファイルによる設定上書き

## 背景

- 一つのリポジトリに対してdocker composeファイルを複数割り当てたい(issue #52)。
- 特定機能(検索/翻訳/メディア分類など)のテスト時のみ外部サーバー用composeを追加したい。
- issueの合意(最終コメント):
  - 機能1: compose.ymlを複数指定して上書きを可能に
  - 機能2: プロファイルで既定の設定を上書き
- 制約: プロファイル変更時もvolume/tunnelは維持する(imageは維持不要)。

## 機能1: composeファイルの複数指定

- `Repository.composePath`(既存のstringカラム)を「1行1パスの改行区切り」として解釈する。
  - DBマイグレーション不要。既存データ(1行)はそのまま有効。
  - `docker compose -f a.yml -f b.yml ...` と連結し、後のファイルが前の定義を上書きする
    (docker compose標準のマージ挙動)。
- 新ヘルパー `server/src/preview/settings.ts`:
  - `parseComposePaths(composePath): string[]` — 改行分割・trim・空行除去。
  - `composeFileArgs(composePath): string[]` — `["-f", p1, "-f", p2, ...]` を生成。
- 適用箇所: buildPreview / destroyPreview / stopPreview / restartPreview / logstream の
  全 `docker compose` 呼び出し。
- UI: リポジトリ設定の「Composeファイルのパス」をtextarea化(1行1ファイル)。

## 機能2: 設定プロファイル

### データモデル

```prisma
model SettingsProfile {
  id           String   @id @default(cuid())
  repositoryId String
  name         String
  // 各フィールドはnullなら既定(Repository側)を継承、非nullなら上書き。
  composePath  String?
  webService   String?
  internalPort Int?
  fileRewrites String?  // JSON配列
  overlayFiles String?  // JSON配列
  resetVolumes Boolean?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  repository Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  previews   PreviewEnvironment[]
  @@unique([repositoryId, name])
}
```

- `PreviewEnvironment.profileId String?`(`onDelete: SetNull`)を追加。
  プレビューがどのプロファイルでビルドされたかを記憶する。
  - composeProject名・hostPort・トンネルはプレビュー行に紐づくため、プロファイルを
    切り替えて再ビルドしてもvolume/tunnelは維持される(issue要件)。
  - プロファイル削除時はSetNullで既定設定にフォールバック。

### 設定の解決

- `resolveSettings(repo, profile): EffectiveSettings` — プロファイルの非nullフィールドで
  既定を上書き(フィールド単位の置換。マージはしない)。
- buildPreview等は preview.profile を含めてロードし、EffectiveSettings を使用する。
- webService/internalPort未設定チェックも EffectiveSettings に対して行う。

### API

- `PUT /repositories/:owner/:name/settings` のbodyに `profiles: ProfileInput[]` を追加。
  - `ProfileInput = { id?, name, composePath|null, webService|null, internalPort|null, fileRewrites|null, overlayFiles|null, resetVolumes|null }`
  - トランザクションで同期: 送信されなかった既存プロファイルは削除、idが自リポジトリの
    ものは更新、それ以外は新規作成。name重複はバリデーションで拒否。
- `GET /repositories/:owner/:name` は `repository.profiles` を含めて返す。
- `POST .../pulls/:number/preview` / `POST .../branch-preview` のbodyに
  `profileId?: string | null` を追加。
  - string: 自リポジトリのプロファイルであることを検証し、previewに保存。
  - null: 既定設定に戻す(previewのprofileIdをクリア)。
  - 未指定(undefined): 既存previewのprofileIdを維持(webhook再ビルドはこちら)。

### UI

- リポジトリ設定画面:
  - 「プロファイル」セクションを追加。プロファイル毎に名前+各フィールドの
    「上書き」チェックボックス(未チェック=既定を継承)。
  - ファイル書き換えルール/オーバーレイファイルのエディタを共通コンポーネント化
    (`RewriteRulesEditor.vue` / `OverlayFilesEditor.vue`)して既定とプロファイルで共用。
  - エクスポート/インポートにprofilesを含める(エクスポート時はidを除去)。
- PreviewPanel: プロファイル選択select(「既定の設定」+プロファイル名)を追加し、
  起動/再ビルド時に `profileId` を送る。使用中プロファイル名も表示。
- PullDetailView / BranchPreviews: プロファイル一覧を取得してパネルへ渡す。
  BranchPreviewsの「ブランチから起動」行にもプロファイル選択を追加。

## テスト

- `server/test/preview/settings.test.ts`(新規): parseComposePaths / composeFileArgs /
  resolveSettings の単体テスト。
- `server/test/migrations/migrate.test.ts`: EXPECTED_TABLES に SettingsProfile を追加。
- `server/test/helpers.ts`: truncateAll に SettingsProfile を追加。

## 対象外(スコープ外)

- プロファイルのfileRewrites/overlayFilesの既定とのマージ(置換のみ。必要なら別issue)。
- ダッシュボード一覧でのプロファイル表示。
