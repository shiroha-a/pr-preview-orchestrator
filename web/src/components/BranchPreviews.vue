<script setup lang="ts">
import { onMounted, ref } from "vue";
import { GitBranch, Play, RefreshCw } from "lucide-vue-next";

import { api } from "../api/client";
import type { BranchInfo, PreviewDTO, SettingsProfileDTO } from "../types";
import PreviewPanel from "./PreviewPanel.vue";
import type { PreviewActions } from "./PreviewPanel.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCard from "./ui/BaseCard.vue";

const props = defineProps<{ owner: string; name: string }>();

const branches = ref<BranchInfo[]>([]);
const branchesLoading = ref(false);
const selectedBranch = ref("");
const starting = ref(false);
const startError = ref<string | null>(null);

const previews = ref<PreviewDTO[]>([]);

// 起動時に選択できる設定プロファイル(issue #52)。""=既定の設定。
const profiles = ref<SettingsProfileDTO[]>([]);
const selectedProfileId = ref("");

async function loadProfiles() {
  try {
    const { repository } = await api.getRepo(props.owner, props.name);
    profiles.value = repository.profiles ?? [];
  } catch {
    /* ignore: プロファイル無しでも起動できる */
  }
}

// ブランチ一覧はサーバー側で5分キャッシュされる。マウント時に自動取得し、
// 「更新」ボタン(force=true)で最新化する。
async function loadBranches(force = false) {
  branchesLoading.value = true;
  startError.value = null;
  try {
    const res = await api.getBranches(props.owner, props.name, force);
    branches.value = res.branches;
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
    await api.startBranchPreview(props.owner, props.name, branch, {
      profileId: selectedProfileId.value || null,
    });
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
    start: (opts) => api.startBranchPreview(props.owner, props.name, preview.branchRef ?? "", opts),
    restart: () => api.restartPreviewById(preview.id),
    destroy: () => api.destroyPreviewById(preview.id).then(() => undefined),
    stop: () => api.stopPreviewById(preview.id),
    refresh: async () => (await api.getPreviewById(preview.id)).preview,
  };
}

onMounted(() => {
  void loadPreviews();
  void loadBranches();
  void loadProfiles();
});
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">ブランチから起動</h2>
    <BaseCard>
      <div class="space-y-2 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <GitBranch class="h-4 w-4 shrink-0 text-gray-500" />
          <select
            v-model="selectedBranch"
            :disabled="branchesLoading || branches.length === 0"
            class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          >
            <option v-if="branches.length === 0" value="">
              {{ branchesLoading ? "取得中..." : "ブランチがありません" }}
            </option>
            <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
          </select>
          <BaseButton
            size="sm"
            variant="secondary"
            :disabled="branchesLoading"
            title="ブランチ一覧を更新(GitHubから再取得)"
            @click="loadBranches(true)"
          >
            <RefreshCw :class="['h-4 w-4', branchesLoading && 'animate-spin']" />
            <span class="hidden sm:inline">更新</span>
          </BaseButton>
          <!-- 設定プロファイルの選択(issue #52) -->
          <select
            v-if="profiles.length > 0"
            v-model="selectedProfileId"
            class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
            title="ビルドに使う設定プロファイル"
          >
            <option value="">既定の設定</option>
            <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <BaseButton size="sm" :disabled="starting || !selectedBranch" @click="startBranch">
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
      :profiles="profiles"
    />
  </section>
</template>
