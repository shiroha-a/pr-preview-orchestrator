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

- [x] Prisma: `BuildAgent`モデル追加(name/tokenHash/lastSeenAt/enabled)+ migration
- [x] Repository/SettingsProfileに`buildMode`(auto/remote/local)追加 + migration
- [x] エージェント認証ミドルウェア(トークンハッシュ照合、Basic認証とは別系統)
- [x] ジョブAPI(エージェント向け)
  - [x] `GET /api/agent/jobs`(long-poll + claim。in-memoryレジストリ`agents/registry.ts`)
  - [x] `POST /api/agent/jobs/:id/logs`(ログbatch ingest → 既存SSEへ中継)
  - [x] `POST /api/agent/jobs/:id/image`(docker save|gzipストリーム受領 → docker load)
  - [x] `POST /api/agent/jobs/:id/complete`(成功/失敗報告)
- [x] エージェント管理API(登録=トークン発行(一度だけ表示)/一覧/削除/enabled切替)
- [x] buildPreviewへのリモートビルド統合(auto/remote/local + フォールバック)※Phase 3前倒し
- [x] WebUI: 設定画面にビルドサーバー一覧(online/offline)+ 追加(ワンライナー表示)
- [x] WebUI: リポジトリ/プロファイル設定に`buildMode`選択を追加
- [x] テスト追加(registry 8件・agents routes 7件・buildMode解決1件。計98件パス)

## Phase 3: agentモード + E2E + フォールバック(初期リリース到達点)

- [x] `SERVER_MODE=agent`起動モード(pollループ+実行エンジン、HTTPサーバー/DB/WebUIなし。
      index.tsは動的importで分岐しagentがPrismaを読み込まない)
- [x] エージェント: ジョブ取得 → SHAでcheckout → 注入 → `compose build` →
      built imagesのみ選別(`compose config --format json`)→ save|gzip転送 → 完了報告
- [x] 本体: リモートビルド完了後の`docker load`→`compose up -d`接続
- [x] フォールバック実装(auto/remote/local、claim/初動/idleタイムアウト→failed→local)
- [x] Dockerfile(docker CLI + compose plugin + git同梱、orchestrator/agent両用)+ .dockerignore
- [x] E2E確認(shiroha-a/growbotで実施):
  - [x] リモートビルド成功(dispatch→claim→clone→overlay注入→build→転送→load→up -d→running)
  - [x] claim timeoutフォールバック(オンライン表示・無応答→15秒でローカルへ縮退→running)
  - [x] オフライン+auto(リモートスキップ→直接ローカル→running)
  - [x] オフライン+remote(明示エラーで失敗)
- [x] E2Eで発見したバグ修正: 切断済みlong-pollのwaiterがジョブをclaimして停滞する問題
      (HTTP切断signalでwaiter除去 + claim後の初動タイムアウト30秒)+ 回帰テスト4件
- [x] READMEに環境変数と外部ビルドサーバーのセットアップ手順を追記

## レビュー対応(PR #81)

- [x] 指摘1: remote+エージェントビジーでの不当失敗 → `shouldKeepWaiting`フックを追加し、
      remoteモードはオンラインエージェントが居る限りclaim待ちを継続(オフライン化で失効)
- [x] 指摘2: `docker load`のEPIPEクラッシュ → `child.stdin`のerrorハンドラ追加 +
      入力エラー時のSIGKILLをcode -1として明示(`code ?? 0`の成功誤判定を修正)
- [x] 指摘2: agent側`uploadImages`のEPIPE対策(gzip/stdoutのerrorハンドラ + fetch失敗時の
      docker save kill)+ ワンライナーに`--restart unless-stopped`追加(README/WebUI両方)
- [x] 指摘3: ジョブ操作のagentId一致検証(logs/image/complete/touch)
- [x] 指摘3: READMEにHTTPS推奨(LAN外は必須)を明記
- [x] 指摘4: `uploadImages`の410チェックを終了コード確認より先に
- [x] 指摘4: `LogShipper.flush`をチェーン直列化(完了報告が最終ログを追い越さない)
- [x] 指摘4: image受領エンドポイントがload中のジョブ失効時に410を返す
- [x] 指摘4: Dockerfileのレイヤーキャッシュ(package*.json+prisma先行COPY)
- [x] 指摘4: 登録APIのTOCTOU(P2002捕捉で400)
- [x] 指摘4: registryテストをfake timers化(flake対策)
- [x] カバレッジ: ビルド分岐を`executeBuildStep`として抽出し7ケースをユニットテスト化

## レビュー2対応(PR #81)

- [x] 重要: ビルド中エージェントのオフライン誤判定 → `touchAgent`をスロットリング付き
      never-throw化し、logs/complete/image(チャンク受信)でもハートビートさせる。
      remoteビジー待ち・auto委譲率・WebUI表示の3点を修正
- [x] 中1: GitHubトークンのworkspace残留 → `prepareWorkspace`のfinallyでremote URLを
      トークンなしに戻す(失敗・中断時も掃除)。READMEの記述も実態に合わせ修正
- [x] 中2: 任意イメージタグ受入 → 本体が自checkoutから期待イメージを算出して
      payload.expectedImagesで共有し、agentはそれだけをsave、受領側はload出力の
      `Loaded image:`行を照合して不一致なら失敗(事前manifest検証はPhase 4)
- [x] 中3: 失効ジョブへの転送完走 → onChunkで失効検知したらstreamをdestroyし早期切断
- [x] 中4: ビルド中の無効化/削除で停滞 → `expireAgentJobs`でclaim中ジョブを即失効
- [x] 軽微: pollOnceの未読ボディcancel / claim timeoutメッセージの累計時間化 /
      `ORCHESTRATOR_URL`のURL形式検証(z.url) / 設計書ステータス更新
- [x] テスト追加: LogShipper直列化3件 / unexpectedLoadedImages4件 / expireAgentJobs2件
      (registry+routes)。計125件パス

## Phase 4(初期リリース後・別PR)

- [ ] エージェント側ビルドキャッシュ掃除(定期prune or 本体指示)
- [ ] 転送最適化(built imagesのみ選別/圧縮方式)
- [ ] イメージ受領時のtar manifest検証(load前に期待タグのみ許可。レビュー2指摘2の完全版)
- [ ] Dockerfileのマルチステージ化(devDependencies/webソースを最終イメージから除外)
- [ ] キュー/健全性のUI改善
- [ ] 複数エージェントのスケジューリング
