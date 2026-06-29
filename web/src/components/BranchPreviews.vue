<script setup lang="ts">
import { onMounted, ref } from "vue";
import { GitBranch, Play, RefreshCw } from "lucide-vue-next";

import { api } from "../api/client";
import type { BranchInfo, PreviewDTO } from "../types";
import PreviewPanel from "./PreviewPanel.vue";
import type { PreviewActions } from "./PreviewPanel.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCard from "./ui/BaseCard.vue";

const props = defineProps<{ owner: string; name: string }>();

const branches = ref<BranchInfo[]>([]);
const branchesLoading = ref(false);
const branchesLoaded = ref(false);
const selectedBranch = ref("");
const starting = ref(false);
const startError = ref<string | null>(null);

const previews = ref<PreviewDTO[]>([]);

// ブランチ一覧はGitHub APIを叩くため、ボタン押下時に遅延ロードする。
async function loadBranches() {
  branchesLoading.value = true;
  startError.value = null;
  try {
    const res = await api.getBranches(props.owner, props.name);
    branches.value = res.branches;
    branchesLoaded.value = true;
    if (!selectedBranch.value && branches.value.length > 0) {
      selectedBranch.value = branches.value[0].name;
    }
  } catch (e) {
    startError.value = e instanceof Error ? e.message : "ブランチの取得に失敗しました";
  } finally {
    branchesLoading.value = false;
  }
}

async function loadPreviews() {
  try {
    const res = await api.getBranchPreviews(props.owner, props.name);
    previews.value = res.previews;
  } catch {
    /* ignore: 一時的なエラーは無視 */
  }
}

async function startBranch() {
  const branch = selectedBranch.value;
  if (!branch) return;
  starting.value = true;
  startError.value = null;
  try {
    await api.startBranchPreview(props.owner, props.name, branch);
    await loadPreviews();
  } catch (e) {
    startError.value = e instanceof Error ? e.message : "起動に失敗しました";
  } finally {
    starting.value = false;
  }
}

// PreviewPanel に渡すブランチ用の操作(previewId基点)。
function branchActions(preview: PreviewDTO): PreviewActions {
  return {
    start: (noCache) =>
      api.startBranchPreview(props.owner, props.name, preview.branchRef ?? "", noCache),
    restart: () => api.restartPreviewById(preview.id),
    destroy: () => api.destroyPreviewById(preview.id).then(() => undefined),
    refresh: async () => (await api.getPreviewById(preview.id)).preview,
  };
}

onMounted(loadPreviews);
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">ブランチから起動</h2>
    <BaseCard>
      <div class="space-y-2 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <GitBranch class="h-4 w-4 shrink-0 text-gray-500" />
          <select
            v-if="branchesLoaded"
            v-model="selectedBranch"
            class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
          >
            <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
          </select>
          <BaseButton
            v-else
            size="sm"
            variant="secondary"
            :disabled="branchesLoading"
            @click="loadBranches"
          >
            <RefreshCw :class="['h-4 w-4', branchesLoading && 'animate-spin']" />
            {{ branchesLoading ? "取得中..." : "ブランチを取得" }}
          </BaseButton>
          <BaseButton
            v-if="branchesLoaded"
            size="sm"
            :disabled="starting || !selectedBranch"
            @click="startBranch"
          >
            <Play class="h-4 w-4" />
            {{ starting ? "起動中..." : "起動" }}
          </BaseButton>
        </div>
        <p v-if="startError" class="text-xs text-red-600">{{ startError }}</p>
        <p v-else class="text-xs text-gray-500">
          GitHubのブランチを選んでDockerプレビューを起動できます。
        </p>
      </div>
    </BaseCard>

    <PreviewPanel
      v-for="p in previews"
      :key="p.id"
      :initial-preview="p"
      :actions="branchActions(p)"
      :title="`ブランチ: ${p.branchRef}`"
    />
  </section>
</template>
