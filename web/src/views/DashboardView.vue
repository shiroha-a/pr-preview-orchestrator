<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowRight, GitPullRequest } from "lucide-vue-next";

import { api } from "../api/client";
import type { RepositoryDTO } from "../types";
import BaseCard from "../components/ui/BaseCard.vue";

const loading = ref(true);
const error = ref<string | null>(null);
const repositories = ref<RepositoryDTO[]>([]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    repositories.value = (await api.getRepositories()).repositories;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-semibold">ダッシュボード</h1>
      <p class="mt-1 text-sm text-gray-500">GitHub PRごとのプレビュー環境を管理します。</p>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <section v-else class="space-y-3">
      <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">リポジトリ</h2>
      <BaseCard v-if="repositories.length === 0">
        <div class="p-4 text-sm text-gray-500">
          リポジトリがありません。
          <RouterLink to="/settings" class="text-blue-600 hover:underline">設定ページ</RouterLink>
          から owner/name を指定して追加してください。
        </div>
      </BaseCard>
      <div v-else class="grid gap-3 sm:grid-cols-2">
        <RouterLink
          v-for="repo in repositories"
          :key="repo.id"
          :to="`/repos/${repo.owner}/${repo.name}`"
        >
          <BaseCard class="transition-colors hover:border-blue-300 dark:hover:border-blue-700">
            <div class="flex items-center justify-between gap-2 p-4">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ repo.owner }}/{{ repo.name }}</p>
                <p class="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                  <GitPullRequest class="h-3 w-3" />
                  {{ repo._count?.pullRequests ?? 0 }} 件のPR
                </p>
              </div>
              <ArrowRight class="h-4 w-4 shrink-0 text-gray-400" />
            </div>
          </BaseCard>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
