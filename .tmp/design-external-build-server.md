# 外部ビルドサーバー対応 設計書

> GitHub issue: **#80**(設計議論用として起票済み)
> ステータス: **設計フェーズ(実装未着手)**。
> **決定(改訂)**: 当初のC案(実行まで外部化)は issue #80 の議論を受けて撤回し、
> **「ビルドのみ外部化 + pull型エージェント」**(以下 D'案)を採用する。経緯は3章・9章。

## 1. 目的

現在オーケストレーターは、自身と同一ホスト上で `git` と `docker compose` を直接 `spawn`
して、プレビュー環境のビルド・起動・公開・監視を行う。このうち**ビルド(短期間高負荷 +
ビルドキャッシュによるディスク圧迫)だけを外部のビルドサーバーへ逃がせるように設定可能**にする。

- ビルドの負荷特性: 短期間のCPU/メモリスパイク + ビルドキャッシュ/中間イメージのディスク肥大
  (#67/#69 で顕在化済み)。ここが実際の痛点。
- プレビュー実行の負荷特性: 稼働中の継続負荷。**実行・公開・監視はローカルに残す**(本設計の
  スコープ外。将来やるなら別issueで「外部実行ホスト」として扱う)。

## 2. 現状の「ローカル前提」結合点と本設計の影響範囲

| # | 箇所 | ローカル前提の内容 | D'案での扱い |
|---|---|---|---|
| 1 | ビルド/起動 | `preview/service.ts`: ローカルcheckout → `compose build/up` | **build のみ外部化**。up はローカル維持 |
| 2 | ファイル注入 | `rewrite.ts`/`overlay.ts`/override | **エージェント側でも同一適用**(ジョブに同梱) |
| 3 | volume入出力 | `volumes.ts`/`uploads.ts` | 変更なし(実行はローカル) |
| 4 | ポート割当 | `ports.ts` | 変更なし |
| 5 | プレビューURL | `PREVIEW_HOST:hostPort` | 変更なし |
| 6 | トンネル | `tunnel.ts`(Quick Tunnel) | 変更なし |
| 7 | 監視/掃除 | `df.ts`/`cleanup.ts`/`metrics.ts` | 変更なし(エージェント側キャッシュ掃除のみ追加) |

**設計上の核心**: 外部化の境界を「build」に限定することで #3〜#7 が無改修で残り、
通信もエージェント→本体のアウトバウンドのみになる(pull型)。

## 3. アプローチ比較と決定経緯

- **A. Dockerリモート接続**(`DOCKER_HOST`/SSH): 改修最小だが bind mount/volume がリモートFS
  参照になり #1〜#5 が崩れる。
- **B. バックエンド設定項目化**(Aの発展): Aと同じlocality課題。
- **C. リモートビルドエージェント(実行まで外部化)**: locality問題は消えるが、実行・公開・監視
  まで外部化するためタイトル(ビルドサーバー)とずれる。mTLS/内部CA/エンロール、名前付き
  Cloudflare Tunnel(独自ドメイン)など運用コストが大きい。**→一度採用したが撤回**。
- **D'. ビルドのみ外部化 + pull型エージェント(採用)**: issue #80 コメント(kozakura913氏)の
  提案。ビルドだけ外部で行い、成果物イメージを本体へ転送して実行はローカル。
  - 負荷特性(ビルド=短期高負荷/実行=継続負荷)に沿った分割
  - pull型でアウトバウンドのみ → **mTLS/CA/エンロール不要、トークン認証で足りる**
  - 実行系(#3〜#7)が無改修 → **名前付きトンネル(独自ドメイン依存)も不要**
  - エージェント障害時は**ローカルビルドへフォールバック**可能

## 4. 採用設計(D'案)

### 4.1 アーキテクチャ

```
┌─────────────────────────────┐                    ┌──────────────────────────┐
│ Orchestrator(本体・現行機能)  │ ◀── long-poll ──── │ Build Agent(ビルドサーバー)│
│ - WebUI/SSE/GitHub/DB(真実源)│    (ジョブ取得)     │  docker + agent のみ       │
│ - ジョブキュー(ビルド委譲判断) │ ◀── ログ batch ───  │ - git clone/checkout(SHA) │
│ - compose up -d(ローカル実行) │ ◀── イメージ転送 ──  │ - rewrite/overlay適用      │
│ - port/tunnel/volume/監視    │    (save|gzip)     │ - docker compose build    │
│ - フォールバックのローカルbuild│ ◀── 完了報告 ─────  │ - docker save | gzip      │
└─────────────────────────────┘                    └──────────────────────────┘
        通信はすべてエージェント→本体のアウトバウンド(HTTPS推奨+トークン認証)
```

### 4.2 ビルドジョブのフロー

1. 本体がビルド要求を受ける(WebUI/webhook)。従来通りローカルで `prepareWorkspace` を実行し
   **commit SHA を解決**(実行時のbind mount/override用にローカルcheckoutは引き続き必要)。
2. リモートビルド対象なら、ジョブをキューに積む:
   `{ jobId, previewId, owner, name, sha, composeProject, composeFiles, settings(rewrite/overlay内容), noCache, githubToken? }`
3. エージェントが long-poll でジョブを取得(claim)。**同一SHAをcheckout**し、rewrite/overlay/
   override を本体と同一ロジックで適用(実行エンジンをコード共有、5章)。
4. エージェントが `docker compose build`(project名を本体と揃え、イメージタグ
   `<project>-<service>` を一致させる。`noCache` はここで反映)。
   ログは batch で本体へPOST → 本体が既存SSE基盤でWebUIへ中継。
5. 成功時、`build:` を持つサービスのイメージのみ `docker save | gzip` でストリームアップロード。
   本体は受けながら `docker load`(pull専用イメージは本体側で従来通りpull)。
6. 本体がローカルで `compose up -d`(**--buildなし**)。以降(URL/トンネル/監視)は現行のまま。

### 4.3 build/up の分離(現行実装からの主変更点)

現在は `compose up -d --build` で build+run が融合している。これを分離する:

- **local ビルド時**: `compose build`(必要なら `--no-cache`)→ `compose up -d`。
  外形挙動は現状と等価(Phase 1 の純リファクタで先行実施)。
- **remote ビルド時**: エージェントで build → イメージ転送 → 本体で `compose up -d`。
  compose が再ビルドしないよう、タグ一致(composeProject共有)が前提条件。

### 4.4 フォールバック(決定: 設定で選択)

リポジトリ/プロファイル単位 + グローバル既定で選択:

- `auto`(既定): 健全なエージェントがあればリモート、いなければ/失敗したらローカルビルド
- `remote`: リモートのみ(エージェント不在時はジョブ失敗)
- `local`: 常にローカル(現行挙動)

### 4.5 認証・セキュリティ(mTLS撤回 → トークン)

- pull型でエージェント側に受信ポートがないため、**エージェントごとのAPIトークン**で足りる。
  登録時に一度だけ表示し、DBにはハッシュを保存。
- 本体が信頼できないネットワークに露出する場合はHTTPS前提(既存のBasic認証とは別系統の
  エージェント専用認証ヘッダ)。
- private clone用GitHubトークンは永続化せず**ジョブごとに注入**(既存のログmask踏襲)。

### 4.6 エージェントの状態管理

- `lastSeenAt` を poll ごとに更新。閾値超過で「offline」表示(WebUIのエージェント一覧)。
- ジョブ claim は原子的に(二重取得防止)。claim後にエージェントが死んだ場合はタイムアウトで
  ジョブを failed → フォールバック判断へ。
- エージェント側ディスク: ビルドキャッシュが肥大するため、簡易な掃除ポリシー
  (`docker builder prune` 相当の定期実行 or 本体からの指示)を Phase 4 で追加。

## 5. 実装形態・コード共有(維持)

- `SERVER_MODE=orchestrator|agent` の**2モード起動は維持**。agentモードは「pollループ +
  ビルド実行」のみで、HTTPサーバー・DB・WebUIを持たない。
- checkout/rewrite/overlay/build のロジックは実行エンジンとして抽出し、localビルドと
  エージェントで**同一コードを共有**(再現性の担保)。

## 6. 配布(簡素化)

エージェント要件は **docker + git のみ**(cloudflared不要になった)。同一パッケージの
Dockerイメージを配布し、WebUIの「ビルドサーバーを追加」でトークン入りワンライナーを提示:

```
docker run -d --name pr-preview-agent \
  -e SERVER_MODE=agent \
  -e ORCHESTRATOR_URL=https://orchestrator.example.com \
  -e AGENT_TOKEN=<登録時に発行> \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v pr-preview-agent-data:/data \
  <registry>/pr-preview-orchestrator:<version>
```

エンロール(CSR/証明書交換)は不要になったため、トークンを直接埋め込むだけでよい。

## 7. 設定モデル案

```
model BuildAgent {
  id         String    @id @default(cuid())
  name       String    @unique   // 表示名(例: "gpu-box")
  tokenHash  String              // APIトークンのハッシュ(平文は登録時のみ表示)
  lastSeenAt DateTime?           // poll毎更新。閾値超過でoffline表示
  enabled    Boolean   @default(true)
  createdAt  DateTime  @default(now())
}
```

- `Repository` / `SettingsProfile` に `buildMode String?`(`auto`/`remote`/`local`、
  未指定=グローバル既定)を追加。
- グローバル既定は env: `BUILD_MODE_DEFAULT`(既定 `auto`。エージェント未登録なら実質local)。
- 既存挙動は `local` として**完全後方互換**(エージェント未登録でも従来通り)。

## 8. 段階的導入計画

**初期リリースのゴール: Phase 3 まで**(リモートビルド + フォールバックがE2Eで動く)。

- **Phase 0(本書)**: 設計・アプローチ確定(D'案)。issue #80 で議論。
- **Phase 1**: ローカルフローの build/up 分離(`compose up --build` → `build` + `up -d`)+
  checkout/注入/build の実行エンジン抽出。**外形挙動不変**の純リファクタ(テスト維持)。
- **Phase 2**: ジョブAPI(long-poll claim / ログingest / イメージ受領 / 完了報告)+
  `BuildAgent` モデル + トークン登録 + WebUI(エージェント追加・一覧・online/offline)。
- **Phase 3(初期リリース到達点)**: agentモード実装 + Dockerイメージ配布 +
  リモートビルドE2E + フォールバック(`auto`/`remote`/`local`)。
- **Phase 4(初期リリース後)**: エージェント側キャッシュ掃除、転送最適化(built imagesのみ/
  圧縮方式)、キュー/健全性のUI改善、複数エージェントのスケジューリング。

## 9. 決定事項ログ

- 2026-07-15: C案(実行まで外部化・mTLS/エンロール/名前付きトンネル)を**撤回**。
  issue #80 コメント(kozakura913氏)の指摘: スコープずれ(タイトルは「ビルドサーバー」)、
  負荷特性の違い(ビルド=短期高負荷/実行=継続負荷)、構築コスト。
- **D'案採用**: ビルドのみ外部化。pull型エージェント(アウトバウンドのみ・トークン認証)、
  リポジトリ取得はエージェント側(本体が解決したSHAで再現)、成果物は `docker save | gzip`
  ストリーム転送 → 本体 `docker load`、実行は本体ローカル(`compose up -d`、--buildなし)。
- フォールバック: `auto`/`remote`/`local` を設定で選択(既定 `auto`)。
- 実装形態: `SERVER_MODE=orchestrator|agent` の2モード起動は維持。実行エンジンをコード共有。
- 不要になったもの: mTLS/内部CA/エンロール基盤、名前付きCloudflare Tunnel(独自ドメイン)、
  エージェント側cloudflared。プレビュー公開は現行Quick Tunnelのまま。
- 初期リリースゴール: **Phase 3 まで**(リモートビルド+フォールバックのE2E)。

## 10. 未確定事項(実装時に確定)

1. **long-pollの間隔/待機時間**(例: wait=25s + 即時再接続)とclaimのAPI形。
2. **イメージ転送の最適化**: gzip固定か、zstd等の選択肢。将来レジストリ方式(D)への拡張余地。
3. **エージェント側キャッシュ掃除**の方針(定期prune / 本体からの指示 / 閾値)。
4. **複数エージェント時のジョブ割当**(初期は先取り(claim)のみで十分か)。
