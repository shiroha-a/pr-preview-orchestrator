# issue #48 タスク: トンネルをコンテナ化

- [x] env.ts に `PREVIEW_TUNNEL_IMAGE` を追加
- [x] tunnel.ts をコンテナ方式に書き換え
  - [x] `runDocker` ヘルパー(stdout/stderr結合キャプチャ)
  - [x] `startTunnel`(docker run -d → ログからURL取得、失敗時掃除)
  - [x] `stopTunnel`(docker rm -f、async化)
  - [x] `isTunnelAlive`(docker ps、async化)
  - [x] `getTunnelUrl`(新規、ログから現URL抽出)
- [x] service.ts の呼び出しを更新
  - [x] buildPreview: `await isTunnelAlive` / catch の `await stopTunnel`
  - [x] destroyPreview: `await stopTunnel`
  - [x] stopPreview: `await stopTunnel`
  - [x] restartPreview: `await isTunnelAlive`
  - [x] reattachPreview: 生存コンテナのURL再利用ロジックへ改修
- [x] prettier 整形
- [x] `npm run build` / `typecheck`(型チェックOK)
- [x] テスト(Node24、27 passed)
- [x] 動作確認: URL維持(url1===url2)/停止でコンテナ除去/残留なし を実機確認
      → コミットは確認後
