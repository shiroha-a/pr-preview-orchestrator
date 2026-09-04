# 本体Docker起動時のログインループ(ADMIN_PASSWORDの`$`問題)

## 事象

issue #90で本体をDockerで動かせるようにしたあと、`docker compose up -d`で起動すると
管理画面のBasic認証ダイアログが繰り返し表示され、正しいパスワードを入力してもログインできない。

## 原因

`docker-compose.yml`の`environment`は`"${ADMIN_PASSWORD:-}"`という**compose側の変数展開**で
値を渡している。composeは`.env`を読む際、値の中の`$`をさらに変数参照として展開するため、
`$`を含むパスワードが途中で切れる。

```
.env:  ADMIN_PASSWORD=pa$w0rd
  → warning: The "w0rd" variable is not set. Defaulting to a blank string.
  → コンテナ内: ADMIN_PASSWORD=pa
```

起動時の`syncAdminUser()`は壊れた値`pa`のハッシュをDBへ保存するため、利用者が本来の
`pa$w0rd`を入力しても`verifyPassword`が一致せず401。ブラウザは401のたびに認証ダイアログを
出し直すので、体感としては「ログインループ」になる。

composeの警告は出るが`docker compose up -d`の出力に埋もれて見落としやすく、
アプリ側のログにも認証失敗の記録が無いため原因にたどり着けない。

## 検証結果(compose v5.5.0で実測)

| `.env`の書き方 | コンテナに渡る値 |
| --- | --- |
| `ADMIN_PASSWORD='pa$w0rd'`(シングルクォート) | `pa$w0rd` OK |
| `ADMIN_PASSWORD="pa$w0rd"`(ダブルクォート) | `pa` NG |
| `ADMIN_PASSWORD=pa$w0rd`(クォート無し) | `pa` NG |
| `ADMIN_PASSWORD=pa$$w0rd`(`$$`エスケープ) | `pa$w0rd` OK |
| `ADMIN_PASSWORD='pa$$w0rd'` | `pa$$w0rd` NG(エスケープが二重) |

`.env.example`が`ADMIN_PASSWORD=""`とダブルクォート表記のため、素直に従うと踏み抜く。

## 対応方針

1. **`.env.example`**: 値に`$`が入りうる項目(パスワード・トークン・シークレット)を
   シングルクォート表記にし、`$`の扱いをコメントで明記する。
2. **README**: 「Dockerで動かす」の注意点に同じ内容を追記する。
3. **認証失敗ログ**: `dbBasicAuth`で、認証情報を送ったうえで失敗した場合に警告ログを出す。
   `docker compose logs`から原因を追えるようにする(パスワードは出力しない)。

## 非採用案

- **`env_file`+`format: raw`**: `$`は保たれるがクォートが除去されず、`ADMIN_USER="admin"`が
  `"admin"`(クォート込み)になる。既存の`.env`を壊すため不採用。
- **`env_file`(dotenv形式)**: composeが同様に補間するため`$`問題は解決しない(実測)。
- **`ADMIN_PASSWORD_FILE`方式**: 確実だが利用者の手順が増える。今回の規模では過剰。

## 影響範囲

`.env.example` / `README.md` / `server/src/auth/middleware.ts` / `server/test/auth/middleware.test.ts`。
既存の`.env`や動作中の環境への破壊的変更は無い。
