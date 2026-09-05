# issue #101: docker-buildx-pluginがDockerイメージに無い

## 事象

本体(オーケストレーター)のDocker版でプレビュー環境をビルドすると、
`docker compose build` が次の警告を出す。

```
buildx Docker CLI plugin not found: falling back to the classic builder.
BuildKit-only build features (multi-arch, secrets, ssh, additional contexts, ...)
will not be available
```

## 原因

`Dockerfile` のaptインストール対象が `docker-ce-cli docker-compose-plugin` のみで、
`docker-buildx-plugin` が入っていない。

Compose v2 のビルドはBuildKit(=`docker buildx`)を使う実装で、buildxプラグインが
見つからない場合はクラシックビルダーにフォールバックする。結果として対象リポジトリの
Dockerfileが BuildKit 前提の機能(`RUN --mount`、`--secret`、`--ssh`、追加コンテキスト、
ヒアドキュメント等)を使っているとビルドが失敗する。

ホスト側のdockerデーモン(Docker-out-of-Docker)にbuildxが入っていても関係ない。
buildxは**CLIプラグイン**なので、CLIを実行するコンテナ側に必要。

## 対応

1. `Dockerfile` のaptインストールに `docker-buildx-plugin` を追加する。
   docker公式aptリポジトリは既に設定済みなので、パッケージ名を足すだけでよい。
2. CI(`.github/workflows/ci.yml`)の同梱ツール検証に `docker buildx version` を追加し、
   プラグインが解決できることをamd64/arm64の両方で確認する。

## 非スコープ

- ビルダーインスタンス(`docker buildx create`)の作成。プラグインさえあれば
  compose は既定の `default` ビルダー(dockerデーモン内蔵のBuildKit)を使えるため不要。
- `DOCKER_BUILDKIT` 等の環境変数の明示。Compose v2 は既定でBuildKitを使う。

## 検証

- `docker buildx version` がイメージ内で成功する(CIの検証ステップ)。
- ミューテーション検証: Dockerfileから `docker-buildx-plugin` を外すと同ステップが
  `docker: 'buildx' is not a docker command` で失敗すること。
