<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  Bell,
  CheckCircle2,
  Copy,
  Plus,
  Server,
  Trash2,
  UserPlus,
  Volume2,
  XCircle,
} from "lucide-vue-next";

import { api } from "../api/client";
import {
  disablePush,
  enablePush,
  getPushSubscribed,
  playChime,
  pushUnsupportedReason,
  soundEnabled,
} from "../notifications";
import type { AppConfig, BuildAgentDTO, UserDTO } from "../types";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const loading = ref(true);
const error = ref<string | null>(null);
const config = ref<AppConfig | null>(null);

// ユーザー管理
const users = ref<UserDTO[]>([]);
const usersLoading = ref(false);
const usersError = ref<string | null>(null);
const newUserName = ref("");
const newUserPassword = ref("");
const creatingUser = ref(false);
const createUserError = ref<string | null>(null);
const createUserSuccess = ref<string | null>(null);
const deletingUserId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    config.value = await api.getConfig();
    await Promise.all([loadUsers(), loadAgents()]);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

// 外部ビルドサーバー(issue #80)。トークンは登録直後の一度だけ表示する。
const agents = ref<BuildAgentDTO[]>([]);
const agentsError = ref<string | null>(null);
const newAgentName = ref("");
const creatingAgent = ref(false);
const createdAgentToken = ref<string | null>(null);
const createdAgentName = ref<string | null>(null);
const agentCommandCopied = ref(false);

const agentRunCommand = computed(() => {
  if (!createdAgentToken.value) return "";
  return [
    "docker run -d --name pr-preview-agent \\",
    "  --restart unless-stopped \\",
    "  -e SERVER_MODE=agent \\",
    `  -e ORCHESTRATOR_URL=${window.location.origin} \\`,
    `  -e AGENT_TOKEN=${createdAgentToken.value} \\`,
    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
    "  -v pr-preview-agent-data:/data \\",
    "  pr-preview-orchestrator-agent",
  ].join("\n");
});

async function loadAgents() {
  agentsError.value = null;
  try {
    const res = await api.getBuildAgents();
    agents.value = res.agents;
  } catch (e) {
    agentsError.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  }
}

async function createAgent() {
  const name = newAgentName.value.trim();
  if (!name) {
    agentsError.value = "ビルドサーバー名を入力してください。";
    return;
  }
  creatingAgent.value = true;
  agentsError.value = null;
  createdAgentToken.value = null;
  agentCommandCopied.value = false;
  try {
    const res = await api.createBuildAgent(name);
    createdAgentToken.value = res.token;
    createdAgentName.value = res.agent.name;
    newAgentName.value = "";
    await loadAgents();
  } catch (e) {
    agentsError.value = e instanceof Error ? e.message : "登録に失敗しました";
  } finally {
    creatingAgent.value = false;
  }
}

async function toggleAgent(agent: BuildAgentDTO) {
  agentsError.value = null;
  try {
    await api.setBuildAgentEnabled(agent.id, !agent.enabled);
    await loadAgents();
  } catch (e) {
    agentsError.value = e instanceof Error ? e.message : "更新に失敗しました";
  }
}

async function deleteAgent(agent: BuildAgentDTO) {
  if (!confirm(`ビルドサーバー「${agent.name}」を削除しますか？`)) return;
  agentsError.value = null;
  try {
    await api.deleteBuildAgent(agent.id);
    if (createdAgentName.value === agent.name) {
      createdAgentToken.value = null;
      createdAgentName.value = null;
    }
    await loadAgents();
  } catch (e) {
    agentsError.value = e instanceof Error ? e.message : "削除に失敗しました";
  }
}

async function copyAgentCommand() {
  try {
    await navigator.clipboard.writeText(agentRunCommand.value);
    agentCommandCopied.value = true;
  } catch {
    agentsError.value = "クリップボードへのコピーに失敗しました。";
  }
}

async function loadUsers() {
  usersLoading.value = true;
  usersError.value = null;
  try {
    const res = await api.getUsers();
    users.value = res.users;
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    usersLoading.value = false;
  }
}

onMounted(load);

async function createUser() {
  createUserError.value = null;
  createUserSuccess.value = null;
  const username = newUserName.value.trim();
  const password = newUserPassword.value;
  if (!username || !password) {
    createUserError.value = "ユーザー名とパスワードを入力してください";
    return;
  }
  creatingUser.value = true;
  try {
    const { user } = await api.createUser({ username, password });
    createUserSuccess.value = `${user.username} を追加しました`;
    newUserName.value = "";
    newUserPassword.value = "";
    await loadUsers();
  } catch (e) {
    createUserError.value = e instanceof Error ? e.message : "追加に失敗しました";
  } finally {
    creatingUser.value = false;
  }
}

async function deleteUser(user: UserDTO) {
  if (!confirm(`${user.username} を削除しますか？`)) return;
  deletingUserId.value = user.id;
  try {
    await api.deleteUser(user.id);
    await loadUsers();
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : "削除に失敗しました";
  } finally {
    deletingUserId.value = null;
  }
}

// ビルド完了通知(issue #77)。通知音はブラウザ設定(localStorage)、プッシュ通知は
// 購読状態をブラウザのPushManagerから復元する。
const pushReason = pushUnsupportedReason();
const pushEnabled = ref(false);
const pushBusy = ref(false);
const pushError = ref<string | null>(null);
const pushTestSent = ref(false);

onMounted(async () => {
  pushEnabled.value = await getPushSubscribed().catch(() => false);
});

async function togglePush() {
  pushBusy.value = true;
  pushError.value = null;
  pushTestSent.value = false;
  try {
    if (pushEnabled.value) {
      await disablePush();
      pushEnabled.value = false;
    } else {
      await enablePush();
      pushEnabled.value = true;
    }
  } catch (e) {
    pushError.value = e instanceof Error ? e.message : "プッシュ通知の切り替えに失敗しました";
  } finally {
    pushBusy.value = false;
  }
}

async function sendTestPush() {
  pushBusy.value = true;
  pushError.value = null;
  pushTestSent.value = false;
  try {
    await api.sendTestPush();
    pushTestSent.value = true;
  } catch (e) {
    pushError.value = e instanceof Error ? e.message : "テスト送信に失敗しました";
  } finally {
    pushBusy.value = false;
  }
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-semibold">設定</h1>
      <p class="mt-1 text-sm text-gray-500">
        公開GitHub APIを使用します。リポジトリの追加はダッシュボードから行えます。
      </p>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-else-if="config">
      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">GitHub API</span>
        </div>
        <div class="space-y-1 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">アクセストークン(任意)</span>
            <span v-if="config.tokenSet" class="inline-flex items-center gap-1 text-green-600">
              <CheckCircle2 class="h-4 w-4" />設定済み
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />未設定(公開APIのみ)
            </span>
          </div>
          <p class="pt-1 text-xs text-gray-500">
            <code>GITHUB_TOKEN</code>
            を設定するとレート制限が緩和され、privateリポジトリにもアクセスできます。
          </p>
        </div>
      </BaseCard>

      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">Webhook(自動連携)</span>
        </div>
        <div class="space-y-2 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">
              シークレット(GITHUB_WEBHOOK_SECRET)
            </span>
            <span
              v-if="config.webhookSecretSet"
              class="inline-flex items-center gap-1 text-green-600"
            >
              <CheckCircle2 class="h-4 w-4" />設定済み
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />未設定
            </span>
          </div>
          <p class="text-xs text-gray-500">
            対象リポジトリの Settings → Webhooks で、Payload URL に
            <code>&lt;このサーバーの公開URL&gt;/api/github/webhook</code>、Content type に
            <code>application/json</code>、Secret に <code>GITHUB_WEBHOOK_SECRET</code>
            を設定し、Pull requests
            イベントを購読してください。push時の自動再ビルド・クローズ時の自動破棄が有効になります。
          </p>
        </div>
      </BaseCard>

      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">管理アクセス</span>
        </div>
        <div class="space-y-4 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">Basic認証</span>
            <span
              v-if="config.adminAuthEnabled"
              class="inline-flex items-center gap-1 text-green-600"
            >
              <CheckCircle2 class="h-4 w-4" />有効
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />無効
            </span>
          </div>
          <p class="text-xs text-gray-500">
            <code>ADMIN_USER</code> と <code>ADMIN_PASSWORD</code>
            で初回起動時に admin ユーザーが作成されます。DB
            にユーザーを登録すると管理画面とAPIにBasic認証がかかります(Webhookとヘルスチェックは除外)。
          </p>

          <!-- ユーザー一覧 -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <span class="font-medium">ユーザー一覧</span>
              <span class="text-xs text-gray-500">{{ users.length }} 人</span>
            </div>
            <p v-if="usersLoading" class="text-xs text-gray-500">読み込み中...</p>
            <p v-else-if="usersError" class="text-xs text-red-600">{{ usersError }}</p>
            <table v-else-if="users.length > 0" class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-gray-100 dark:border-gray-800">
                  <th class="pb-1.5 font-medium text-gray-500">ユーザー名</th>
                  <th class="pb-1.5 font-medium text-gray-500">作成日</th>
                  <th class="pb-1.5"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="u in users"
                  :key="u.id"
                  class="border-b border-gray-50 last:border-0 dark:border-gray-800/50"
                >
                  <td class="py-2">{{ u.username }}</td>
                  <td class="py-2 text-gray-500">
                    {{ new Date(u.createdAt).toLocaleDateString() }}
                  </td>
                  <td class="py-2 text-right">
                    <button
                      v-if="users.length > 1"
                      class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      :disabled="deletingUserId === u.id"
                      @click="deleteUser(u)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                      {{ deletingUserId === u.id ? "削除中..." : "削除" }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-xs text-gray-500">ユーザーが登録されていません。</p>
          </div>

          <!-- ユーザー追加フォーム -->
          <form class="space-y-2" @submit.prevent="createUser">
            <div class="flex items-center gap-2">
              <UserPlus class="h-4 w-4 text-gray-500" />
              <span class="font-medium">ユーザーを追加</span>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                v-model="newUserName"
                :class="inputClass"
                placeholder="ユーザー名"
                type="text"
              />
              <input
                v-model="newUserPassword"
                :class="inputClass"
                placeholder="パスワード"
                type="password"
              />
            </div>
            <div class="flex items-center justify-end gap-3">
              <span v-if="createUserSuccess" class="text-xs text-green-600">{{
                createUserSuccess
              }}</span>
              <span v-if="createUserError" class="text-xs text-red-600">{{ createUserError }}</span>
              <BaseButton type="submit" :disabled="creatingUser">
                <Plus class="h-4 w-4" />
                {{ creatingUser ? "追加中..." : "追加" }}
              </BaseButton>
            </div>
          </form>
        </div>
      </BaseCard>

      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">プレビュー環境</span>
        </div>
        <div class="space-y-1 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">外部公開(Cloudflare Tunnel)</span>
            <span
              v-if="config.preview.tunnel"
              class="inline-flex items-center gap-1 text-green-600"
            >
              <CheckCircle2 class="h-4 w-4" />有効
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />無効(localhost)
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">クローン先ディレクトリ</span>
            <code class="text-xs">{{ config.preview.workspacesDir }}</code>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">ポート範囲</span>
            <code class="text-xs">{{ config.preview.portMin }} - {{ config.preview.portMax }}</code>
          </div>
        </div>
      </BaseCard>

      <!-- 外部ビルドサーバー(issue #80) -->
      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">外部ビルドサーバー</span>
        </div>
        <div class="space-y-4 px-4 py-3 text-sm">
          <p class="text-xs text-gray-500">
            Dockerイメージのビルドを外部ホストへ委譲します(実行・公開はこのサーバーのまま)。既定のビルドモードは
            <code>{{ config.buildModeDefault }}</code>
            (<code>BUILD_MODE_DEFAULT</code>)。リポジトリ/プロファイル単位でも指定できます。
          </p>

          <!-- 登録済み一覧 -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <span class="font-medium">登録済みビルドサーバー</span>
              <span class="text-xs text-gray-500">{{ agents.length }} 台</span>
            </div>
            <table v-if="agents.length > 0" class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-gray-100 dark:border-gray-800">
                  <th class="pb-1.5 font-medium text-gray-500">名前</th>
                  <th class="pb-1.5 font-medium text-gray-500">状態</th>
                  <th class="pb-1.5 font-medium text-gray-500">最終通信</th>
                  <th class="pb-1.5"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="a in agents"
                  :key="a.id"
                  class="border-b border-gray-50 last:border-0 dark:border-gray-800/50"
                >
                  <td class="py-2">{{ a.name }}</td>
                  <td class="py-2">
                    <span v-if="!a.enabled" class="text-gray-400">無効</span>
                    <span
                      v-else-if="a.online"
                      class="inline-flex items-center gap-1 text-green-600"
                    >
                      <CheckCircle2 class="h-3.5 w-3.5" />オンライン
                    </span>
                    <span v-else class="inline-flex items-center gap-1 text-gray-400">
                      <XCircle class="h-3.5 w-3.5" />オフライン
                    </span>
                  </td>
                  <td class="py-2 text-gray-500">
                    {{ a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : "未接続" }}
                  </td>
                  <td class="py-2 text-right whitespace-nowrap">
                    <button
                      class="rounded-md px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      @click="toggleAgent(a)"
                    >
                      {{ a.enabled ? "無効化" : "有効化" }}
                    </button>
                    <button
                      class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      @click="deleteAgent(a)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />削除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-xs text-gray-500">
              ビルドサーバーが登録されていません。すべてのビルドはローカルで実行されます。
            </p>
          </div>

          <!-- 追加フォーム -->
          <form class="space-y-2" @submit.prevent="createAgent">
            <div class="flex items-center gap-2">
              <Server class="h-4 w-4 text-gray-500" />
              <span class="font-medium">ビルドサーバーを追加</span>
            </div>
            <div class="flex gap-2">
              <input
                v-model="newAgentName"
                :class="inputClass"
                placeholder="名前(例: build-1)"
                type="text"
              />
              <BaseButton type="submit" :disabled="creatingAgent">
                <Plus class="h-4 w-4" />
                {{ creatingAgent ? "登録中..." : "登録" }}
              </BaseButton>
            </div>
            <p v-if="agentsError" class="text-xs text-red-600">{{ agentsError }}</p>
          </form>

          <!-- 登録直後のトークン表示(この画面でのみ確認できる) -->
          <div
            v-if="createdAgentToken"
            class="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/10"
          >
            <p class="text-xs font-medium text-amber-700 dark:text-amber-400">
              「{{
                createdAgentName
              }}」のトークンを発行しました。以下のコマンドをビルドサーバーで実行してください。トークンは再表示できません。
            </p>
            <pre
              class="overflow-x-auto rounded bg-gray-900 p-2 text-[11px] leading-relaxed text-gray-100"
              >{{ agentRunCommand }}</pre>
            <div class="flex items-center justify-end gap-2">
              <span v-if="agentCommandCopied" class="text-xs text-green-600">コピーしました</span>
              <BaseButton size="sm" variant="secondary" @click="copyAgentCommand">
                <Copy class="h-3.5 w-3.5" />コマンドをコピー
              </BaseButton>
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- ビルド完了通知(issue #77) -->
      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">通知(ビルド完了)</span>
        </div>
        <div class="space-y-3 px-4 py-3 text-sm">
          <div class="flex items-center justify-between gap-2 py-1.5">
            <label class="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300">
              <Volume2 class="h-4 w-4" />
              <input v-model="soundEnabled" type="checkbox" class="h-3.5 w-3.5 accent-blue-600" />
              通知音を鳴らす
            </label>
            <BaseButton size="sm" variant="secondary" @click="playChime('success')">
              テスト再生
            </BaseButton>
          </div>
          <p class="text-xs text-gray-500">
            プレビューのページを開いているとき、ビルド完了(成功/失敗)で音を鳴らします。この設定はブラウザごとに保存されます。
          </p>

          <div class="flex items-center justify-between gap-2 py-1.5">
            <label
              class="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300"
              :class="pushReason ? 'opacity-50' : ''"
            >
              <Bell class="h-4 w-4" />
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-blue-600"
                :checked="pushEnabled"
                :disabled="pushBusy || pushReason != null"
                @change="togglePush"
              />
              プッシュ通知を受け取る
            </label>
            <div class="flex items-center gap-2">
              <span v-if="pushTestSent" class="text-xs text-green-600">送信しました</span>
              <BaseButton
                v-if="pushEnabled"
                size="sm"
                variant="secondary"
                :disabled="pushBusy"
                @click="sendTestPush"
              >
                テスト送信
              </BaseButton>
            </div>
          </div>
          <p v-if="pushReason" class="text-xs text-amber-600">{{ pushReason }}</p>
          <p v-if="pushError" class="text-xs text-red-600">{{ pushError }}</p>
          <p class="text-xs text-gray-500">
            タブを閉じていてもビルド完了をブラウザ通知で受け取れます。通知に必要な鍵(VAPID)はサーバーが自動生成するため設定は不要です。通知クリックで該当のPR/ブランチページを開きます。
          </p>
        </div>
      </BaseCard>
    </template>
  </div>
</template>
