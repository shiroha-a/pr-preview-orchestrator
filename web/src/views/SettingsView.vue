<script setup lang="ts">
import { onMounted, ref } from "vue";
import { CheckCircle2, Plus, XCircle } from "lucide-vue-next";

import { api } from "../api/client";
import type { AppConfig } from "../types";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const loading = ref(true);
const error = ref<string | null>(null);
const config = ref<AppConfig | null>(null);

// リポジトリ追加フォーム
const repoInput = ref("");
const adding = ref(false);
const addError = ref<string | null>(null);
const addSuccess = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    config.value = await api.getConfig();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function addRepo() {
  addError.value = null;
  addSuccess.value = null;
  const [owner, name] = repoInput.value.trim().split("/");
  if (!owner || !name) {
    addError.value = "owner/name の形式で入力してください(例: vercel/next.js)";
    return;
  }
  adding.value = true;
  try {
    const { repository } = await api.addRepository(owner, name);
    addSuccess.value = `${repository.owner}/${repository.name} を追加しました`;
    repoInput.value = "";
  } catch (e) {
    addError.value = e instanceof Error ? e.message : "追加に失敗しました";
  } finally {
    adding.value = false;
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
        公開GitHub APIを使用します。リポジトリを追加してPRを取得してください。
      </p>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-else-if="config">
      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">リポジトリを追加</span>
        </div>
        <form class="space-y-3 px-4 py-3" @submit.prevent="addRepo">
          <div>
            <label class="mb-1 block text-sm font-medium">リポジトリ(owner/name)</label>
            <input v-model="repoInput" :class="inputClass" placeholder="vercel/next.js" />
            <p class="mt-1 text-xs text-gray-500">
              公開リポジトリを追加できます(privateは任意トークン設定時のみ)。
            </p>
          </div>
          <div class="flex items-center justify-end gap-3">
            <span v-if="addSuccess" class="text-xs text-green-600">{{ addSuccess }}</span>
            <span v-if="addError" class="text-xs text-red-600">{{ addError }}</span>
            <BaseButton type="submit" :disabled="adding">
              <Plus class="h-4 w-4" />
              {{ adding ? "追加中..." : "追加" }}
            </BaseButton>
          </div>
        </form>
      </BaseCard>

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
        <div class="space-y-2 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">
              Basic認証(ADMIN_USER / ADMIN_PASSWORD)
            </span>
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
            を設定すると、管理画面とAPIにBasic認証がかかります(Webhookとヘルスチェックは除外)。
          </p>
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
    </template>
  </div>
</template>
