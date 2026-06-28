<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ExternalLink, GitBranch } from "lucide-vue-next";

import { api } from "../api/client";
import type { CommentDTO, PreviewDTO, PullRequestDTO } from "../types";
import CommentList from "../components/CommentList.vue";
import DiffView from "../components/DiffView.vue";
import PrStateBadge from "../components/PrStateBadge.vue";
import PreviewPanel from "../components/PreviewPanel.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const route = useRoute();
const owner = route.params.owner as string;
const name = route.params.name as string;
const number = Number(route.params.number);

const loading = ref(true);
const error = ref<string | null>(null);
const pr = ref<PullRequestDTO | null>(null);
const preview = ref<PreviewDTO | null>(null);
const loadError = ref<string | null>(null);

const diff = ref("");
const diffLoading = ref(true);
const comments = ref<CommentDTO[]>([]);
const commentsLoading = ref(true);

async function loadMain() {
  try {
    const res = await api.getPull(owner, name, number);
    pr.value = res.pullRequest;
    preview.value = res.preview;
    loadError.value = res.loadError;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

async function loadDiff() {
  try {
    diff.value = (await api.getPullDiff(owner, name, number)).diff;
  } catch {
    diff.value = "";
  } finally {
    diffLoading.value = false;
  }
}

async function loadComments() {
  try {
    comments.value = (await api.getPullComments(owner, name, number)).comments;
  } catch {
    comments.value = [];
  } finally {
    commentsLoading.value = false;
  }
}

onMounted(() => {
  void loadMain();
  void loadDiff();
  void loadComments();
});
</script>

<template>
  <div class="space-y-6">
    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-else-if="pr">
      <div>
        <RouterLink :to="`/repos/${owner}/${name}`" class="text-xs text-gray-500 hover:underline">
          ← {{ owner }}/{{ name }}
        </RouterLink>
        <div class="mt-1 flex flex-wrap items-center gap-3">
          <h1 class="text-xl font-semibold">
            {{ pr.title }} <span class="text-gray-400">#{{ pr.number }}</span>
          </h1>
          <PrStateBadge :state="pr.state" />
          <a
            v-if="pr.htmlUrl"
            :href="pr.htmlUrl"
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <ExternalLink class="h-3 w-3" />
            GitHubで開く
          </a>
        </div>
        <p class="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
          <span>{{ pr.authorLogin }}</span>
          <GitBranch class="h-3.5 w-3.5" />
          <code class="text-xs">{{ pr.headRef }}</code>
          <span>→</span>
          <code class="text-xs">{{ pr.baseRef }}</code>
        </p>
      </div>

      <BaseCard
        v-if="loadError"
        class="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      >
        <div class="p-4 text-sm text-amber-800 dark:text-amber-300">
          GitHubからの最新取得に失敗したため、キャッシュを表示しています({{ loadError }})。
        </div>
      </BaseCard>

      <PreviewPanel :owner="owner" :name="name" :number="number" :initial-preview="preview" />

      <section v-if="pr.body" class="space-y-2">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">説明</h2>
        <BaseCard>
          <div class="p-4 text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200">
            {{ pr.body }}
          </div>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">変更差分</h2>
        <BaseCard>
          <div class="p-4">
            <p v-if="diffLoading" class="text-sm text-gray-500">差分を読み込み中...</p>
            <DiffView v-else :diff="diff" />
          </div>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">コメント・レビュー</h2>
        <p v-if="commentsLoading" class="text-sm text-gray-500">コメントを読み込み中...</p>
        <CommentList v-else :comments="comments" />
      </section>
    </template>
  </div>
</template>
