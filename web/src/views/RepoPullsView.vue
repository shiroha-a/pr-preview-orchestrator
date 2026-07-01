<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Milestone, Settings } from "lucide-vue-next";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

import { api } from "../api/client";
import type { PrLabel, PullRequestDTO, RepositoryDTO } from "../types";
import AsyncButton from "../components/AsyncButton.vue";
import BranchPreviews from "../components/BranchPreviews.vue";
import DraftBadge from "../components/DraftBadge.vue";
import PrStateBadge from "../components/PrStateBadge.vue";
import PreviewStatusBadge from "../components/PreviewStatusBadge.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const route = useRoute();
const owner = route.params.owner as string;
const name = route.params.name as string;

const loading = ref(true);
const error = ref<string | null>(null);
const repository = ref<RepositoryDTO | null>(null);
const pullRequests = ref<PullRequestDTO[]>([]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.getRepoPulls(owner, name);
    repository.value = res.repository;
    pullRequests.value = res.pullRequests;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const syncPulls = () => api.syncPulls(owner, name);

function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ja });
}

// labels はJSON文字列で保存されているため表示時にparseする(issue #24)。
function parseLabels(raw: string | null): PrLabel[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PrLabel[];
  } catch {
    return [];
  }
}

// PRステータスでのフィルタ(issue #30)。Draftはopen扱いのGitHub仕様だが別カテゴリとして扱う。
type PrFilter = "all" | "open" | "draft" | "closed" | "merged";

const FILTERS: { key: PrFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "open", label: "Open" },
  { key: "draft", label: "Draft" },
  { key: "closed", label: "Closed" },
  { key: "merged", label: "Merged" },
];

const activeFilter = ref<PrFilter>("all");

function matchesFilter(pr: PullRequestDTO, f: PrFilter): boolean {
  switch (f) {
    case "open":
      return pr.state === "open" && !pr.draft;
    case "draft":
      // クローズ済み(またはマージ済み)のDraftはClose/Merged側に入れ、Draftには含めない(issue #37)。
      return pr.draft && pr.state === "open";
    case "closed":
      return pr.state === "closed";
    case "merged":
      return pr.state === "merged";
    default:
      return true;
  }
}

const counts = computed<Record<PrFilter, number>>(() => {
  const c: Record<PrFilter, number> = { all: 0, open: 0, draft: 0, closed: 0, merged: 0 };
  for (const pr of pullRequests.value) {
    c.all++;
    if (matchesFilter(pr, "open")) c.open++;
    if (matchesFilter(pr, "draft")) c.draft++;
    if (matchesFilter(pr, "closed")) c.closed++;
    if (matchesFilter(pr, "merged")) c.merged++;
  }
  return c;
});

const filteredPulls = computed(() =>
  pullRequests.value.filter((pr) => matchesFilter(pr, activeFilter.value)),
);
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <RouterLink to="/" class="text-xs text-gray-500 hover:underline"
          >← ダッシュボード</RouterLink
        >
        <h1 class="mt-1 text-xl font-semibold">{{ owner }}/{{ name }}</h1>
        <p class="mt-1 text-sm text-gray-500">{{ pullRequests.length }} 件のPR</p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <RouterLink
          :to="`/repos/${owner}/${name}/settings`"
          class="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs whitespace-nowrap text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Settings class="h-3.5 w-3.5" />
          プレビュー設定
        </RouterLink>
        <AsyncButton :action="syncPulls" label="PRを同期" @done="load" />
      </div>
    </div>

    <BranchPreviews :owner="owner" :name="name" />

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-else>
      <BaseCard v-if="pullRequests.length === 0">
        <div class="p-4 text-sm text-gray-500">
          キャッシュされたPRはありません。「PRを同期」を押してGitHubから取得してください。
        </div>
      </BaseCard>
      <template v-else>
        <!-- ステータスフィルタ(issue #30) -->
        <div class="flex flex-wrap gap-1">
          <button
            v-for="f in FILTERS"
            :key="f.key"
            :class="[
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeFilter === f.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
            ]"
            @click="activeFilter = f.key"
          >
            {{ f.label }}
            <span
              :class="[
                'rounded-full px-1.5 text-[10px]',
                activeFilter === f.key ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700',
              ]"
            >
              {{ counts[f.key] }}
            </span>
          </button>
        </div>

        <BaseCard v-if="filteredPulls.length === 0">
          <div class="p-4 text-sm text-gray-500">このフィルタに該当するPRはありません。</div>
        </BaseCard>
        <ul v-else class="space-y-2">
          <li v-for="pr in filteredPulls" :key="pr.id">
            <RouterLink :to="`/repos/${owner}/${name}/pull/${pr.number}`">
              <BaseCard class="transition-colors hover:border-blue-300 dark:hover:border-blue-700">
                <div class="flex items-center justify-between gap-3 p-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium">#{{ pr.number }}</span>
                      <span class="truncate text-sm">{{ pr.title }}</span>
                    </div>
                    <p class="mt-0.5 text-xs text-gray-500">
                      {{ pr.authorLogin }} ・ {{ relativeTime(pr.prUpdatedAt) }}
                    </p>
                    <!-- Labels / Milestone(issue #24) -->
                    <div
                      v-if="parseLabels(pr.labels).length || pr.milestone"
                      class="mt-1.5 flex flex-wrap items-center gap-1.5"
                    >
                      <span
                        v-for="label in parseLabels(pr.labels)"
                        :key="label.name"
                        class="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300"
                      >
                        <span
                          class="h-2 w-2 rounded-full"
                          :style="{ backgroundColor: `#${label.color}` }"
                        />
                        {{ label.name }}
                      </span>
                      <span
                        v-if="pr.milestone"
                        class="inline-flex items-center gap-1 text-xs text-gray-500"
                      >
                        <Milestone class="h-3 w-3" />
                        {{ pr.milestone }}
                      </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <DraftBadge v-if="pr.draft" />
                    <PreviewStatusBadge v-if="pr.preview" :status="pr.preview.status" />
                    <PrStateBadge :state="pr.state" />
                  </div>
                </div>
              </BaseCard>
            </RouterLink>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
