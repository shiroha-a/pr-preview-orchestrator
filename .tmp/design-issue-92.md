# 不要イメージ削除で解放容量が0と報告される (issue #92)

## 事象

不要イメージ削除の結果が次のように報告される。

```
不要イメージ削除 (01:57): プレビューイメージ29件を削除 / dangling: Total reclaimed space: 0B
```

29件削除したのに解放容量が0Bに見える。

## 原因

`startImagePrune`(`server/src/docker/cleanup.ts`)の処理は2段階になっている。

1. 破棄済みプレビューのorphanイメージを`docker rmi`で個別に削除する
   → **削除件数だけを数えており、解放容量は集計していない**
2. 残ったdanglingを`docker image prune -f`で削除し、その出力の最終行
   (`Total reclaimed space: X`)を報告に載せる

1で実体が消えたあとに2を実行するため、danglingはほぼ残っておらず`0B`になる。
`docker rmi`は解放バイト数を出力しないので、29件分の容量はどこにも現れない。

## 対応

削除の**前後で`docker system df`のImages使用量を取得し、その差分**を「解放: X」として
報告する。danglingの生出力(`Total reclaimed space: 0B`)は誤解を招くため落とし、
総解放量に一本化する。

```
プレビューイメージ29件を削除 / 3件は使用中のためスキップ / 解放: 12.3GB
```

### 解放量の求め方を差分にする理由

削除対象イメージの`Size`単純合計(`docker images`のSIZE相当)は、共有レイヤーを
イメージごとに重複計上する。プレビューイメージは同じベースを共有することが多く、
実際の解放量より大幅に大きい値になるため採用しない。

`docker system df`の差分にはクリーンアップ中に進行した他のビルドの影響が乗りうるが、
その場合はイメージが増える方向なので解放量は**過小**に出る(安全側)。

## 実装

| 対象 | 内容 |
| --- | --- |
| `server/src/docker/df.ts` | `formatDockerSize`(bytes → "12.3GB")を追加。`parseDockerSize`の対 |
| `server/src/docker/df.ts` | `getImagesSizeBytes()`を追加。`docker system df`のImages行のサイズを返す |
| `server/src/docker/cleanup.ts` | 削除前後のサイズを取得。差分計算`computeFreedBytes`と報告文言`formatImagePruneSummary`を純粋関数へ切り出す |

計測に失敗しても削除自体は成功しているため、例外にせず解放量の表示だけを省く。

## テスト

- `formatImagePruneSummary`: 件数・スキップ・解放量の各組み合わせ
- `computeFreedBytes`: 差分、並行ビルドで増えた場合の0クランプ、計測失敗時のnull
- `formatDockerSize`: 単位の境界値、`parseDockerSize`との往復

`startImagePrune`本体はdockerとDBに依存するため、判断ロジックを上記の純粋関数へ
切り出したうえでテストする。
