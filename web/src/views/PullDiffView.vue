<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { RefreshCw } from "lucide-vue-next";

import { api } from "../api/client";
import type { PullRequestDTO } from "../types";
import DiffView from "../components/DiffView.vue";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";

/**
 * Dedicated page for a PR's diff (issue #65). Rendering large diffs inline on
 * the PR detail page made it heavy while watching preview logs, so the diff
 * lives on its own route (which also defers loading diff2html until needed).
 */
const route = useRoute();
const owner = route.params.owner as string;
const name = route.params.name as string;
const number = Number(route.params.number);

const pr = ref<PullRequestDTO | null>(null);
const diff = ref("");
const loading = ref(true);
const error = ref<string | null>(null);
const refreshing = ref(false);

async function loadPr() {
  try {
    pr.value = (await api.getPull(owner, name, number)).pullRequest;
  } catch {
    /* タイトルが出ないだけで差分表示には支障がないため無視 */
  }
}

async function loadDiff(refresh = false) {
  loading.value = true;
  error.value = null;
  try {
    diff.value = (await api.getPullDiff(owner, name, number, refresh)).diff;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "差分の読み込みに失敗しました";
    diff.value = "";
  } finally {
    loading.value = false;
  }
}

// 「更新」ボタン: GitHubから取り直してキャッシュを更新する。
async function refreshDiff() {
  refreshing.value = true;
  try {
    await loadDiff(true);
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => {
  void loadPr();
  void loadDiff();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <RouterLink
        :to="`/repos/${owner}/${name}/pull/${number}`"
        class="text-xs text-gray-500 hover:underline"
      >
        ← PR #{{ number }} に戻る
      </RouterLink>
      <div class="mt-1 flex flex-wrap items-center gap-3">
        <h1 class="text-xl font-semibold">
          変更差分<template v-if="pr">: {{ pr.title }}</template>
          <span class="text-gray-400">#{{ number }}</span>
        </h1>
        <BaseButton
          class="ml-auto"
          variant="secondary"
          size="sm"
          :disabled="refreshing"
          @click="refreshDiff"
        >
          <RefreshCw :class="['h-3.5 w-3.5', refreshing && 'animate-spin']" />
          更新
        </BaseButton>
      </div>
    </div>

    <BaseCard>
      <div class="p-4">
        <p v-if="loading" class="text-sm text-gray-500">差分を読み込み中...</p>
        <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>
        <DiffView v-else :diff="diff" />
      </div>
    </BaseCard>
  </div>
</template>
