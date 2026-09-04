# ダッシュボードのディスク表示ラベルが「/」固定 (issue #97)

## 事象

ダッシュボードの「システム使用状況」で、ディスクの行が常に「ディスク (/)」と表示される。
実際に計測しているのは`METRICS_DISK_PATH`(既定`/var/lib/docker`)なので、dockerの
データルートを`/`と別のディスクに置いている環境ではラベルと実態が食い違う。

## 原因

`web/src/components/SystemMetrics.vue:224`がラベルを固定文字列で持っている。
`/api/metrics`のレスポンスは`disk: { total, used, free }`のみで、計測対象のパスを含まない。

## 対応

`/api/metrics`の`disk`に**実際に計測したパス**を含め、ラベルをそれで組み立てる。

`/api/config`の`preview.metricsDiskPath`(設定値)ではなく実測パスにするのは、
`METRICS_DISK_PATH`が読めない場合に`/`へフォールバックする仕様があるため
(rootless docker、bind mount忘れなど。issue #90)。設定値をラベルにすると、
フォールバックが起きたときに誤ったパスを表示することになる。

```
ディスク (/var/lib/docker)   通常
ディスク (/)                 フォールバック時
ディスク                      どちらも計測できない場合(値は0)
```

## 実装

| 対象 | 内容 |
| --- | --- |
| `server/src/routes/metrics.ts` | `resolveDiskUsage`を切り出し、計測に使ったパスを`disk.path`として返す |
| `web/src/types.ts` | `SystemMetrics.disk`に`path: string \| null`を追加 |
| `web/src/components/SystemMetrics.vue` | ラベルを`disk.path`から組み立てる |

`resolveDiskUsage`は計測関数を引数で受け取れるようにし、statfsに依存せずテストできる形にする。
設定パスが`/`の場合はフォールバック先と同じなので二重計測しない。

`/api/config`の`preview.metricsDiskPath`(設定画面で使用)は変更しない。

## テスト

- `resolveDiskUsage`: 設定パスで計測できる場合 / `/`へフォールバックする場合 /
  どちらも失敗する場合 / 設定パスが`/`のときに二重計測しないこと
