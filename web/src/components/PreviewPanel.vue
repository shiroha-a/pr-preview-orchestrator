<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ExternalLink, Loader2, Play, RotateCw, Square } from "lucide-vue-next";

import { api } from "../api/client";
import type { PreviewDTO } from "../types";
import PreviewStatusBadge from "./PreviewStatusBadge.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCard from "./ui/BaseCard.vue";

const props = defineProps<{
  owner: string;
  name: string;
  number: number;
  initialPreview: PreviewDTO | null;
}>();

const status = ref(props.initialPreview?.status ?? "idle");
const url = ref<string | null>(props.initialPreview?.url ?? null);
const previewId = ref<string | null>(props.initialPreview?.id ?? null);
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
      if (data.status === "running" || data.status === "stopped") void refresh();
    }
  });
  es.addEventListener("log", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { line?: string };
    if (data.line) logs.value.push(data.line);
  });
}

async function refresh() {
  try {
    const { preview } = await api.getPreview(props.owner, props.name, props.number);
    if (preview) {
      status.value = preview.status;
      url.value = preview.url;
      previewId.value = preview.id;
    }
  } catch {
    /* ignore */
  }
}

async function start() {
  busy.value = true;
  actionError.value = null;
  logs.value = [];
  try {
    const res = await api.startPreview(props.owner, props.name, props.number);
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
    await api.destroyPreview(props.owner, props.name, props.number);
    status.value = "stopping";
    if (previewId.value) connect(previewId.value);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "破棄に失敗しました";
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
        <span class="text-sm font-semibold">プレビュー環境</span>
        <PreviewStatusBadge :status="status" />
      </div>
      <div class="flex items-center gap-2">
        <span v-if="isActive" class="flex items-center gap-1 text-xs text-gray-500">
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
          処理中...
        </span>
        <template v-else>
          <BaseButton size="sm" :disabled="busy" @click="start">
            <component :is="status === 'running' ? RotateCw : Play" class="h-4 w-4" />
            {{ status === "running" ? "再ビルド" : "プレビューを起動" }}
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
