# ghcr.ioへ本体イメージをpublishする (issue #94)

## 要件

本体(オーケストレーター)のビルド済みイメージを`ghcr.io`で配布し、利用者が自分で
`docker build`しなくても`docker compose`で起動できるようにする。

- 対象アーキテクチャ: **linux/amd64 + linux/arm64**(利用者確認済み)
- タグ・リリースは未運用のため、**mainへのpushで`latest`を更新**する運用にする
- 手動実行(`workflow_dispatch`)も可能にする

## 方式

### ビルド: アーキテクチャごとのネイティブランナー + manifest list

QEMUエミュレーションでarm64をビルドすると`npm ci`とviteビルドが極端に遅くなるため、
publicリポジトリで使えるarm64ネイティブランナー(`ubuntu-24.04-arm`)を使い、
アーキテクチャごとに並列ビルドしてから manifest list をまとめる(docker公式の分散ビルド手順)。

1. `build`ジョブ(matrix: amd64=`ubuntu-latest` / arm64=`ubuntu-24.04-arm`)
   - タグを付けずダイジェストのみpush(`push-by-digest=true`)
   - ダイジェストをartifactへ退避
   - キャッシュはプラットフォームごとにscopeを分ける(`type=gha`)
2. `merge`ジョブ
   - 各ダイジェストを`docker buildx imagetools create`でmanifest listにまとめ、タグを付けてpush

タグは`latest`(既定ブランチのみ)と`sha-<short>`(巻き戻し用)。

### PR段階でのarm64ビルド検証

`publish.yml`はmainへのpushでしか走らないため、そのままだとarm64のビルドが通るかを
マージ後にしか確認できない。既存CIの`docker`ジョブをアーキテクチャのmatrixにし、
PRの段階で両アーキのイメージビルドと同梱ツール検証が走るようにする。

### compose

`docker-compose.yml`の`image:`をghcrのイメージに向ける。`build: .`は残すため、
`docker compose up -d --build`での自前ビルドは従来どおり動く。
`APP_IMAGE`で参照先を上書きできるようにする(fork運用・別レジストリ向け)。

composeは`build:`がある場合、ローカルにイメージが無ければ**pullではなくbuild**するため、
ビルド済みイメージを使うには`docker compose pull`を先に実行する必要がある。
READMEにはこの手順を明記する。

## 注意点

- `GITHUB_TOKEN`でpushしたパッケージは、リポジトリがpublicでも**初回はprivate**になる。
  他者が`docker pull`できるようにするには、初回publish後にパッケージ設定で
  visibilityをpublicへ変更する必要がある(READMEに記載)。
- Dockerfileのdocker aptリポジトリは`dpkg --print-architecture`でアーキテクチャを
  解決しているため、arm64でもそのまま動く。
- ネイティブモジュール(`bcrypt` / `better-sqlite3`)はlinux-arm64のprebuiltが配布されて
  いるため、追加のビルドツールは不要な見込み。CIのarm64ビルドで確認する。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| `.github/workflows/publish.yml` | 新規。ghcr.ioへのマルチアーキpublish |
| `docker-compose.yml` | `image:`をghcrのイメージに変更(`APP_IMAGE`で上書き可) |
| `.env.example` | `APP_IMAGE`をコメントアウトで提示(既定値はcompose側に一本化) |
| `.github/workflows/ci.yml` | `docker`ジョブをamd64/arm64のmatrixに変更 |
| `README.md` | 「Dockerで動かす」にpull手順とパッケージ公開設定を追記 |

## セルフレビューでの修正

- GHAキャッシュのscopeに`linux/amd64`をそのまま使うとスラッシュが含まれるため、
  `PLATFORM_PAIR`(`linux-amd64`)へ変更した。
- `.env.example`に`APP_IMAGE`の実値を書くと利用者の`.env`へ焼き付き、既定イメージを
  変更しても反映されないため、コメントアウトでの提示に変更した。
- arm64ビルドの検証がマージ後になってしまう問題に対し、CIの`docker`ジョブをmatrix化した。

## テストについて

CI設定・compose・ドキュメントのみの変更でユニットテストの対象が無い。
既存CIの`docker`ジョブ(`docker compose config -q` + イメージビルド + 同梱ツール検証)と、
新規publishワークフローの実行そのものが検証になる。
