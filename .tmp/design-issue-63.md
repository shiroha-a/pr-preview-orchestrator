# issue #63: 同じログが何重にも出ることがある

## 原因

`server/src/preview/logstream.ts` のstale-cleanupバグ。

`startLogStream` はプレビューごとに `docker compose logs -f` の子プロセスを
`streams` Map で管理し、開始時に既存プロセスをkillして置き換える。しかし
子プロセスの `close`/`error` ハンドラが無条件に `streams.delete(previewId)` を
実行するため、次の順序で新しいストリームの登録が消える:

1. 再ビルド完了 → `startLogStream`: 旧プロセスAをkill(Mapから同期的に削除)し、
   新プロセスBを `streams.set`
2. その後、killされたAの `close` イベントが**非同期に遅れて**発火し、
   `streams.delete(previewId)` が**Bの登録を削除**してしまう
3. Bはプロセスとして生きたまま追跡不能(孤児)になり、以後の `stopLogStream` で
   killできない
4. 次の再ビルドで新プロセスCが起動 → BとCが同じログをそれぞれ
   `emitPreviewLog` に流し、各行が2重に表示される。以降、再ビルドのたびに
   孤児が1本ずつ増え、多重度が増加する

`docker compose logs -f` はコンテナ再作成後も新しいコンテナに追従するため
孤児は生き続ける。issueの「再ビルドするたびに増える?」および「再現方法が謎」
(closeイベントの到着タイミング依存)と一致する。

## 修正

`close`/`error` ハンドラで、Mapの登録が**自分自身のときだけ**削除する:

```ts
const cleanup = () => {
  if (streams.get(opts.previewId) === child) streams.delete(opts.previewId);
};
```

これにより置き換え後に旧プロセスの終了イベントが遅れて届いても、新しい
ストリームの登録は消えず、次回の `stopLogStream` で確実にkillされる。

## 影響範囲

- `logstream.ts` のみ。API・挙動の変更なし(重複配信の解消のみ)
- サーバー再起動時は子プロセスのstdoutパイプが閉じてEPIPEで死ぬため、
  既存環境に残った孤児プロセスはサーバー再起動で解消される

## テスト

- `npm run typecheck` / `npm run test -w server`(回帰確認)
- 実プロセス(docker)依存のためユニットテストは追加しない。
  デプロイ後、再ビルドを複数回行いログが1重のままであることを手動確認
