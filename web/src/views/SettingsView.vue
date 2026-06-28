<script setup lang="ts">
import { onMounted, ref } from "vue";
import { CheckCircle2, XCircle } from "lucide-vue-next";

import { api } from "../api/client";
import type { AppConfig } from "../types";
import AsyncButton from "../components/AsyncButton.vue";
import BaseBadge from "../components/ui/BaseBadge.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const loading = ref(true);
const error = ref<string | null>(null);
const config = ref<AppConfig | null>(null);

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

const syncRepositories = () => api.syncRepositories();
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-semibold">設定</h1>
      <p class="mt-1 text-sm text-gray-500">GitHub App接続と環境設定の状態を確認します。</p>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-else-if="config">
      <BaseCard>
        <div
          class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"
        >
          <span class="text-sm font-semibold">GitHub App</span>
          <BaseBadge :tone="config.githubReady ? 'green' : 'amber'">
            {{ config.githubReady ? "接続可能" : "未設定" }}
          </BaseBadge>
        </div>
        <div class="space-y-1 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">GITHUB_APP_ID</span>
            <span
              v-if="config.github.appIdSet"
              class="inline-flex items-center gap-1 text-green-600"
            >
              <CheckCircle2 class="h-4 w-4" />設定済み
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />未設定
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">GITHUB_APP_PRIVATE_KEY</span>
            <span
              v-if="config.github.privateKeySet"
              class="inline-flex items-center gap-1 text-green-600"
            >
              <CheckCircle2 class="h-4 w-4" />設定済み
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />未設定
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">GITHUB_WEBHOOK_SECRET</span>
            <span
              v-if="config.github.webhookSecretSet"
              class="inline-flex items-center gap-1 text-green-600"
            >
              <CheckCircle2 class="h-4 w-4" />設定済み
            </span>
            <span v-else class="inline-flex items-center gap-1 text-gray-400">
              <XCircle class="h-4 w-4" />未設定
            </span>
          </div>

          <div v-if="!config.githubReady" class="pt-2 text-xs text-gray-500">
            <code>.env</code>にGitHub
            Appの認証情報を設定してください。作成手順はREADMEを参照してください。
          </div>
          <div v-else class="flex justify-end pt-2">
            <AsyncButton :action="syncRepositories" label="リポジトリを同期" variant="primary" />
          </div>
        </div>
      </BaseCard>

      <BaseCard>
        <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span class="text-sm font-semibold">プレビュー環境</span>
        </div>
        <div class="space-y-1 px-4 py-3 text-sm">
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">クローン先ディレクトリ</span>
            <code class="text-xs">{{ config.preview.workspacesDir }}</code>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-gray-600 dark:text-gray-300">プレビューホスト</span>
            <code class="text-xs">{{ config.preview.host }}</code>
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
