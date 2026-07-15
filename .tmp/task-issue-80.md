# タスク一覧: 外部ビルドサーバー対応(issue #80)

設計書: `.tmp/design-external-build-server.md`(D'案: ビルドのみ外部化 + pull型エージェント)
ブランチ: `feature/external-build-server`

## Phase 1: build/up分離 + 実行エンジン抽出(純リファクタ・外形挙動不変)

- [x] 現状の`preview/service.ts`のビルドフロー精査(buildPreviewの分解点の特定)
- [x] `compose up -d --build` を `compose build` + `compose up -d`(--buildなし)に分離
- [x] checkout/rewrite/overlay/override/buildを実行エンジン(DB非依存)として抽出
  - [x] `preview/engine.ts`にworkspace準備(`prepareWorkspace`)・ファイル注入(`injectBuildFiles`)・composeビルド(`buildImages`)・`runCommand`・`composeArgs`を移設
  - [x] ログ/キャンセル(AbortSignal)/mask/アイドルタイムアウトの既存挙動を維持(コード移動のみ)
- [x] `service.ts`はエンジン呼び出し+DB状態管理に整理(-274行)
- [x] 既存テストが全て通ることを確認(`npm run test`: 82 passed)
- [x] typecheck(`npm run typecheck`: server/webともpass)
- [x] フォーマッタ適用(`npm run format`)

## Phase 2: ジョブAPI + BuildAgentモデル + WebUI

- [ ] Prisma: `BuildAgent`モデル追加(name/tokenHash/lastSeenAt/enabled)+ migration
- [ ] Repository/SettingsProfileに`buildMode`(auto/remote/local)追加 + migration
- [ ] エージェント認証ミドルウェア(トークンハッシュ照合、Basic認証とは別系統)
- [ ] ジョブAPI(エージェント向け)
  - [ ] `GET /api/agent/jobs`(long-poll + 原子的claim)
  - [ ] `POST /api/agent/jobs/:id/logs`(ログbatch ingest → 既存SSEへ中継)
  - [ ] `POST /api/agent/jobs/:id/image`(docker save|gzipストリーム受領 → docker load)
  - [ ] `POST /api/agent/jobs/:id/complete`(成功/失敗報告)
- [ ] エージェント管理API(登録=トークン発行(一度だけ表示)/一覧/削除/enabled切替)
- [ ] WebUI: 設定画面にビルドサーバー一覧(online/offline)+ 追加(ワンライナー表示)
- [ ] WebUI: リポジトリ/プロファイル設定に`buildMode`選択を追加
- [ ] テスト追加(claim原子性・認証・buildMode解決)

## Phase 3: agentモード + E2E + フォールバック(初期リリース到達点)

- [ ] `SERVER_MODE=agent`起動モード(pollループ+実行エンジン、HTTPサーバー/DB/WebUIなし)
- [ ] エージェント: ジョブ取得 → SHAでcheckout → 注入 → `compose build` → save|gzip転送 → 完了報告
- [ ] 本体: リモートビルド完了後の`docker load`→`compose up -d`接続
- [ ] フォールバック実装(auto/remote/local、エージェント死亡時のジョブタイムアウト→failed→local)
- [ ] Dockerfile(docker CLI + git同梱)とイメージビルド
- [ ] E2E確認(単一エージェント: リモートビルド成功/失敗/不在フォールバック)
- [ ] READMEにエージェントのセットアップ手順追記

## Phase 4(初期リリース後・別PR)

- [ ] エージェント側ビルドキャッシュ掃除(定期prune or 本体指示)
- [ ] 転送最適化(built imagesのみ選別/圧縮方式)
- [ ] キュー/健全性のUI改善
- [ ] 複数エージェントのスケジューリング
