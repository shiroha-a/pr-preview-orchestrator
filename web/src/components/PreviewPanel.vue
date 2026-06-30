<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  Eraser,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Square,
} from "lucide-vue-next";

import type { PreviewDTO } from "../types";
import BaseBadge from "./ui/BaseBadge.vue";
import PreviewStatusBadge from "./PreviewStatusBadge.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCard from "./ui/BaseCard.vue";

/**
 * Operations the panel performs, abstracting whether the preview targets a PR
 * or a branch (issue #25). The parent supplies the concrete API calls.
 */
export interface PreviewActions {
  start: (noCache: boolean) => Promise<{ previewId: string }>;
  restart: () => Promise<{ previewId: string }>;
  destroy: () => Promise<void>;
  /** Stop containers without removing them (issue #32). */
  stop: () => Promise<unknown>;
  refresh: () => Promise<PreviewDTO | null>;
}

const props = defineProps<{
  initialPreview: PreviewDTO | null;
  actions: PreviewActions;
  prHeadSha?: string;
  title?: string;
}>();

const status = ref(props.initialPreview?.status ?? "idle");
const url = ref<string | null>(props.initialPreview?.url ?? null);
const previewId = ref<string | null>(props.initialPreview?.id ?? null);
const commitSha = ref<string | null>(props.initialPreview?.commitSha ?? null);
const logs = ref<string[]>(
  props.initialPreview?.logs ? props.initialPreview.logs.split("\n").filter(Boolean) : [],
);
const actionError = ref<string | null>(null);
const busy = ref(false);

const ACTIVE = ["pending", "cloning", "building", "stopping"];
const isActive = computed(() => ACTIVE.includes(status.value));
const canStop = computed(
  () => previewId.value != null && !isActive.value && status.value !== "idle",
);
// ビルド進行中(clone/build)は中断して破棄できるようにする(issue #33)。
// stopping は片付け中なので対象外。
const canInterrupt = computed(() => ["pending", "cloning", "building"].includes(status.value));

// ビルド済みコミットがPR最新コミットと異なれば「古い」と判定する(issue #17)。
const isOutdated = computed(
  () => !!props.prHeadSha && !!commitSha.value && commitSha.value !== props.prHeadSha,
);

let es: EventSource | null = null;

function disconnect() {
  if (es) {
    es.close();
    es = null;
  }
}

function connect(id: string) {
  disconnect();
  es = new EventSource(`/api/preview/${id}/events`);
  es.addEventListener("status", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { status?: string };
    if (data.status) {
      status.value = data.status;
      if (["running", "stopped", "paused"].includes(data.status)) void refresh();
    }
  });
  es.addEventListener("log", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { line?: string };
    if (data.line) logs.value.push(data.line);
  });
}

async function refresh() {
  try {
    const preview = await props.actions.refresh();
    if (preview) {
      status.value = preview.status;
      url.value = preview.url;
      previewId.value = preview.id;
      commitSha.value = preview.commitSha;
    }
  } catch {
    /* ignore */
  }
}

// noCache=true でビルドキャッシュを破棄して再ビルドする(issue #20)。
async function start(noCache = false) {
  busy.value = true;
  actionError.value = null;
  logs.value = [];
  try {
    const res = await props.actions.start(noCache);
    previewId.value = res.previewId;
    status.value = "pending";
    connect(res.previewId);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "起動に失敗しました";
  } finally {
    busy.value = false;
  }
}

async function destroy() {
  busy.value = true;
  actionError.value = null;
  try {
    await props.actions.destroy();
    status.value = "stopping";
    if (previewId.value) connect(previewId.value);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "破棄に失敗しました";
  } finally {
    busy.value = false;
  }
}

// 破棄せずコンテナを停止する(後で再開可能。issue #32)。
async function stop() {
  busy.value = true;
  actionError.value = null;
  try {
    await props.actions.stop();
    status.value = "stopping";
    if (previewId.value) connect(previewId.value);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "停止に失敗しました";
  } finally {
    busy.value = false;
  }
}

// ビルドせずにコンテナを再起動(トンネルは流用)。
async function restart() {
  busy.value = true;
  actionError.value = null;
  logs.value = [];
  try {
    const res = await props.actions.restart();
    previewId.value = res.previewId;
    status.value = "building";
    connect(res.previewId);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "再起動に失敗しました";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (previewId.value) connect(previewId.value);
});
onUnmounted(disconnect);
</script>

<template>
  <BaseCard>
    <div
      class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">{{ title ?? "プレビュー環境" }}</span>
        <PreviewStatusBadge :status="status" />
      </div>
      <div class="flex items-center gap-2">
        <template v-if="isActive">
          <span class="flex items-center gap-1 text-xs text-gray-500">
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            処理中...
          </span>
          <!-- ビルド中でも中断して破棄できる(issue #33) -->
          <BaseButton
            v-if="canInterrupt"
            size="sm"
            variant="danger"
            :disabled="busy"
            title="進行中のビルドを中断してプレビューを破棄します"
            @click="destroy"
          >
            <Square class="h-4 w-4" />
            中断・破棄
          </BaseButton>
        </template>
        <template v-else>
          <!-- 一時停止からの再開(issue #32) -->
          <BaseButton v-if="status === 'paused'" size="sm" :disabled="busy" @click="restart">
            <Play class="h-4 w-4" />
            再開
          </BaseButton>
          <BaseButton v-else size="sm" :disabled="busy" @click="start()">
            <component :is="status === 'running' ? RotateCw : Play" class="h-4 w-4" />
            {{ status === "running" ? "再ビルド" : "プレビューを起動" }}
          </BaseButton>
          <BaseButton
            v-if="status === 'running'"
            size="sm"
            variant="secondary"
            :disabled="busy"
            @click="restart"
          >
            <RotateCcw class="h-4 w-4" />
            再起動
          </BaseButton>
          <BaseButton
            v-if="status === 'running'"
            size="sm"
            variant="secondary"
            :disabled="busy"
            title="ビルドキャッシュを破棄して再ビルドします"
            @click="start(true)"
          >
            <Eraser class="h-4 w-4" />
            キャッシュ破棄して再ビルド
          </BaseButton>
          <!-- 破棄せず停止(後で再開可能。issue #32) -->
          <BaseButton
            v-if="status === 'running'"
            size="sm"
            variant="secondary"
            :disabled="busy"
            title="破棄せずコンテナを停止します(後で再開可能)"
            @click="stop"
          >
            <Pause class="h-4 w-4" />
            停止(保持)
          </BaseButton>
          <BaseButton v-if="canStop" size="sm" variant="danger" :disabled="busy" @click="destroy">
            <Square class="h-4 w-4" />
            停止・破棄
          </BaseButton>
        </template>
      </div>
    </div>

    <div class="space-y-3 px-4 py-3">
      <div v-if="url" class="text-sm">
        <a
          :href="url"
          target="_blank"
          rel="noreferrer"
          class="inline-flex items-center gap-1 text-blue-600 hover:underline"
        >
          <ExternalLink class="h-4 w-4" />
          {{ url }}
        </a>
      </div>
      <p v-else-if="!isActive && status === 'idle'" class="text-sm text-gray-500">
        まだプレビュー環境は作成されていません。
      </p>

      <!-- ビルド済みコミットとPR最新コミットの比較(issue #17) -->
      <p v-if="commitSha" class="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span>ビルド済み</span>
        <code>{{ commitSha.slice(0, 7) }}</code>
        <template v-if="prHeadSha">
          <span>/ 最新</span>
          <code>{{ prHeadSha.slice(0, 7) }}</code>
          <BaseBadge v-if="isOutdated" tone="amber">新しいコミットあり</BaseBadge>
          <BaseBadge v-else tone="green">最新</BaseBadge>
        </template>
      </p>

      <p v-if="actionError" class="text-xs text-red-600">{{ actionError }}</p>

      <div
        v-if="logs.length"
        class="max-h-80 overflow-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100"
      >
        <pre class="break-all whitespace-pre-wrap">{{ logs.join("\n") }}</pre>
      </div>
    </div>
  </BaseCard>
</template>
