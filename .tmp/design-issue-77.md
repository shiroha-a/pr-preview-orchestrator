# issue #77: ビルド完了時の通知(通知音+Webプッシュ通知)

## 背景

ビルドを裏で放置しているとき、完了に気づけない(issue #77)。加えて、タブを閉じていても
届くWebプッシュ通知も欲しい(依頼者追記)。プッシュ通知に必要なVAPIDキーは手動設定なしで
自動生成する。

## 要件

1. **通知音**: ビルドが完了(成功=running / 失敗=failed)したとき、開いているページで
   通知音を鳴らす。成功と失敗で音を変える。設定でオン/オフできる(既定オフ、ブラウザごとに
   localStorageへ保存)。
2. **Webプッシュ通知**: ビルド完了時に、購読済みブラウザへプッシュ通知を送る。
   - VAPIDキーは初回利用時にサーバーが自動生成しDBへ保存する(環境変数・手動設定なし)。
   - 設定画面のトグルで購読/解除できる。テスト送信ボタンを設ける。
   - 通知クリックで該当PR/ブランチのページを開く。
   - 非対応環境(非セキュアコンテキスト等)ではトグルを無効化し理由を表示する。
3. ビルド中断(stop/destroyによるキャンセル)は通知しない(ユーザー自身の操作のため)。
4. 通知の失敗はビルド処理に影響させない(ログのみ)。

## 設計

### サーバー

- 依存追加: `web-push`(+ `@types/web-push`)。
- Prismaモデル追加(マイグレーション `add_web_push`):
  - `WebPushKeys`: 自動生成したVAPIDキーペア(実質1行)。
  - `PushSubscription`: ブラウザの購読(endpoint一意、p256dh/auth)。
- `server/src/push/service.ts`:
  - `getVapidPublicKey(p)`: DBのキーを返す。無ければ `webpush.generateVAPIDKeys()` で
    生成して保存(自動生成)。
  - `saveSubscription(p, sub)` / `removeSubscription(p, endpoint)`。
  - `notifyAll(p, payload, send?)`: 全購読へ送信。404/410(購読失効)は購読を削除。
    その他のエラーはログのみ。`send` はテスト用に注入可能。
  - VAPID subject はリポジトリURL固定。
- `server/src/routes/push.ts`(`/api/push`、basic auth配下):
  - `GET /public-key` → `{ publicKey }`(初回アクセスで自動生成)
  - `POST /subscribe` → endpoint で upsert
  - `POST /unsubscribe` → endpoint で削除
  - `POST /test` → 全購読へテスト通知
- `server/src/preview/service.ts` の `buildPreview`:
  - `BuildTarget` に `appPath`(Web UIの該当ページパス)を追加。
  - 成功(`running`)/失敗(`failed`)確定後に `void notifyAll(...)` で通知
    (fire-and-forget。本文は `owner/name label` + PRタイトル)。

### Web

- `web/public/sw.js`: Service Worker。`push` で `showNotification`、
  `notificationclick` で該当ページをフォーカス/オープン。
- `web/src/notifications.ts`:
  - 通知音設定(localStorage永続の`ref`)と Web Audio API によるチャイム再生
    (音声ファイル不要。成功=上昇2音、失敗=下降2音)。
  - プッシュ購読ヘルパー: 対応判定、購読状態取得、購読(SW登録→通知許可→
    `pushManager.subscribe`→サーバー登録)、解除。
- `web/src/api/client.ts`: `getPushPublicKey` / `subscribePush` / `unsubscribePush` /
  `sendTestPush` を追加。
- `web/src/views/SettingsView.vue`: 「通知」カードを追加(通知音トグル+音テスト、
  プッシュ通知トグル+テスト送信、非対応時の理由表示)。
- `web/src/components/PreviewPanel.vue`: SSEのstatusイベントで、ビルド中
  (pending/cloning/building)→ running/failed の遷移を検知して通知音を再生。

### テスト

- `server/test/routes/push.test.ts`:
  - public-keyの自動生成と永続(2回目も同じキー)
  - subscribe のupsert(同一endpointで重複しない)/ unsubscribe の削除
  - `notifyAll`: 410で購読が削除される、他エラーでは残る(send注入)

## 制約・注意

- Web Push / Notification API はセキュアコンテキスト(HTTPSまたはlocalhost)必須。
  平文HTTPでLANアクセスしている場合はプッシュ通知を利用できない(UIで案内)。
- 通知音はブラウザの自動再生制限により、ページ操作後でないと鳴らないことがある。
