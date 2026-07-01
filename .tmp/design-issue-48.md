# issue #48: トンネルをサブプロセスからDockerコンテナへ

## 背景・課題

現状 `server/src/preview/tunnel.ts` は `spawn("cloudflared", ...)` で
Cloudflare Quick Tunnel を**Nodeプロセスの子プロセス**として起動している。

このためオーケストレーターアプリを更新等で再起動すると、子プロセスの
cloudflared も一緒に死に、再起動後は新しいトンネルを張り直す。Quick Tunnel
のURL(`https://<random>.trycloudflare.com`)は起動ごとにランダムなので、
**再起動のたびにプレビューURLが変わり**、そのURLを焼き込んで動いている
プレビュー中アプリ(例: Misskey系)がリンク切れで死ぬ。

## 目的

トンネルを**Dockerコンテナとして隔離**し、オーケストレーターアプリの
再起動から独立して生存させる。アプリ再起動後はコンテナがそのまま生きて
いるので、同じトンネル(=同じURL)を維持できる。

## 方針

各プレビューのトンネルを、previewId から決まる名前
`preview-tunnel-<previewId>` のデタッチドコンテナとして起動する。

```
docker run -d \
  --name preview-tunnel-<previewId> \
  --network host \
  --restart unless-stopped \
  --label pr-preview-orchestrator-tunnel=1 \
  cloudflare/cloudflared:latest \
  tunnel --url http://localhost:<hostPort>
```

- `--network host`: ホストのネットワーク名前空間を共有し、コンテナ内の
  `localhost:<hostPort>` = ホストの公開ポートに到達する(旧サブプロセスと
  同一の到達性。Linux前提)。
- `--restart unless-stopped`: Dockerデーモン再起動/ホスト再起動でも復帰。
  手動 `stop`/`rm` した場合は復帰しない。
- イメージ entrypoint が `cloudflared --no-autoupdate` のため、コマンド引数は
  `tunnel --url ...` のみでよい。
- URLはコンテナの `docker logs` から正規表現で抽出する。コンテナが再起動して
  ログに複数URLが出た場合を考慮し、**最後にマッチしたURL**を採用する。

### 実機検証済み

- コンテナ方式で `--network host` からホスト API(8787)へ到達し、ログから
  URL抽出に成功。
- 旧サブプロセス方式でも同じQuick Tunnelを生成。両方式で外部到達性は同一
  (このホスト自身からのcurlは環境要因で000になるが、これは方式差ではない)。

## API変更(tunnel.ts)

同期→非同期化(docker CLI呼び出しのため)。

| 関数 | 変更 |
| --- | --- |
| `startTunnel(previewId, port)` | `docker run` でコンテナ起動→ログからURL取得。失敗時はコンテナ掃除。 |
| `stopTunnel(previewId)` | `docker rm -f <name>`(async化)。 |
| `isTunnelAlive(previewId)` | `docker ps` で running 判定(async化)。 |
| `getTunnelUrl(previewId)` | **新規**。稼働中コンテナのログから現在のURLを読む。 |

## service.ts の変更

- `isTunnelAlive`/`stopTunnel` の呼び出しを `await` 化(全て async 関数内)。
- **reattachPreview**(再起動後の復帰)を要改修:
  - 従来は「常に新トンネルを張り直す」→URLが毎回変わっていた。
  - 変更後: トンネルコンテナが生存していれば `getTunnelUrl` でURLを読み直して
    DBを同期(コンテナが独立生存 = **URL維持**)。コンテナが無い場合のみ新規に張る。
  これが issue #48 の本質的な解決(再起動でURLが変わらない)。

## env.ts

- `PREVIEW_TUNNEL_IMAGE`(default `cloudflare/cloudflared:latest`)を追加。

## 影響範囲・非対象

- `tunnel.ts` を利用するのは `service.ts` のみ(他importなし)。
- 破棄時は `docker rm -f` でコンテナも除去するためリークしない。
- DBワイプ等でDB外に取り残されたトンネルコンテナの掃除はラベルで手動可能
  (今回の自動GCは対象外)。
