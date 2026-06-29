<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ArrowRight, ExternalLink, GitPullRequest } from "lucide-vue-next";

import { api } from "../api/client";
import type { PreviewListItem, RepositoryDTO } from "../types";
import PreviewStatusBadge from "../components/PreviewStatusBadge.vue";
import SystemMetrics from "../components/SystemMetrics.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const loading = ref(true);
const error = ref<string | null>(null);
const repositories = ref<RepositoryDTO[]>([]);
const previews = ref<PreviewListItem[]>([]);

const ACTIVE = ["pending", "cloning", "building", "running", "stopping"];
const activePreviews = computed(() => previews.value.filter((p) => ACTIVE.includes(p.status)));

// プレビューはPRまたはブランチを対象とする(issue #25)。表示用の情報を解決する。
function previewRepo(p: PreviewListItem): { owner: string; name: string } | null {
  return p.pullRequest?.repository ?? p.repository;
}
function previewLink(p: PreviewListItem): string {
  const r = previewRepo(p);
  if (!r) return "/";
  return p.pullRequest
    ? `/repos/${r.owner}/${r.name}/pull/${p.pullRequest.number}`
    : `/repos/${r.owner}/${r.name}`;
}
function previewHeading(p: PreviewListItem): string {
  const r = previewRepo(p);
  const slug = r ? `${r.owner}/${r.name}` : "";
  return p.pullRequest ? `${slug} #${p.pullRequest.number}` : slug;
}
function previewSubtitle(p: PreviewListItem): string {
  return p.pullRequest ? p.pullRequest.title : `ブランチ: ${p.branchRef}`;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [repos, prev] = await Promise.all([api.getRepositories(), api.getPreviews()]);
    repositories.value = repos.repositories;
    previews.value = prev.previews;
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

    <SystemMetrics />

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-else>
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">稼働中のプレビュー</h2>
        <BaseCard v-if="activePreviews.length === 0">
          <div class="p-4 text-sm text-gray-500">稼働中のプレビュー環境はありません。</div>
        </BaseCard>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <BaseCard v-for="p in activePreviews" :key="p.id">
            <div class="space-y-2 p-4">
              <div class="flex items-center justify-between gap-2">
                <RouterLink
                  :to="previewLink(p)"
                  class="truncate text-sm font-medium hover:underline"
                >
                  {{ previewHeading(p) }}
                </RouterLink>
                <PreviewStatusBadge :status="p.status" />
              </div>
              <p class="truncate text-xs text-gray-500">{{ previewSubtitle(p) }}</p>
              <a
                v-if="p.url"
                :href="p.url"
                target="_blank"
                rel="noreferrer"
                class="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <ExternalLink class="h-3 w-3" />
                {{ p.url }}
              </a>
            </div>
          </BaseCard>
        </div>
      </section>

      <section class="space-y-3">
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
    </template>
  </div>
</template>
