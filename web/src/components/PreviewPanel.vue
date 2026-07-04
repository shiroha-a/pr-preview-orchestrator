<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ExternalLink, Loader2, Pause, Play, RotateCcw, RotateCw, Square } from "lucide-vue-next";

import type { RestartPreviewOptions, StartPreviewOptions } from "../api/client";
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
  start: (opts?: StartPreviewOptions) => Promise<{ previewId: string }>;
  restart: (opts?: RestartPreviewOptions) => Promise<{ previewId: string }>;
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
  /** Selectable settings profiles of the repository (issue #52). */
  profiles?: { id: string; name: string }[];
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

// 起動/再ビルドに使うプロファイル(""=既定の設定)。初期値は前回ビルド時の選択。
const selectedProfileId = ref(props.initialPreview?.profileId ?? "");
// 現在のプレビューが使っているプロファイル(表示用)。
const currentProfileId = ref<string | null>(props.initialPreview?.profileId ?? null);
const currentProfileName = computed(
  () => props.profiles?.find((p) => p.id === currentProfileId.value)?.name ?? null,
);

// 再ビルドオプション(チェックボックスで選択。#20/#41/#42を1つの再ビルドに集約)。
// 全て「チェック=破棄/再作成」の極性に統一する(issue #50)。resetTunnel は
// keepTunnel の反転で、既定(未チェック)ではトンネル(URL)を維持する。
// resetVolumes/resetTunnel は「再起動」にも適用される(issue #58)。
const rebuildOpts = ref({
  noCache: false,
  resetVolumes: false,
  resetTunnel: false,
});

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
      currentProfileId.value = preview.profileId;
    }
  } catch {
    /* ignore */
  }
}

// ビルドオプション: noCache(#20) / resetVolumes(#41) / keepTunnel(#42) / profileId(#52)。
async function start(opts: StartPreviewOptions = {}) {
  busy.value = true;
  actionError.value = null;
  logs.value = [];
  try {
    // プロファイル一覧があるときのみ選択を明示送信する(""=null=既定の設定)。
    // 未送信(undefined)ならサーバー側で前回のプロファイルが維持される。
    const profileOpts =
      props.profiles && props.profiles.length > 0
        ? { profileId: selectedProfileId.value || null }
        : {};
    const res = await props.actions.start({ ...profileOpts, ...opts });
    previewId.value = res.previewId;
    status.value = "pending";
    connect(res.previewId);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "起動に失敗しました";
  } finally {
    busy.value = false;
  }
}

// チェックボックスで選んだオプションを付けて再ビルドする。トンネルは既定で維持し、
// 「トンネル破棄」チェック時のみ再作成する(URLが変わる)。issue #50。
function rebuild() {
  void start({
    noCache: rebuildOpts.value.noCache,
    resetVolumes: rebuildOpts.value.resetVolumes,
    keepTunnel: !rebuildOpts.value.resetTunnel,
  });
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

// ビルドせずにコンテナを再起動(既定ではボリューム・トンネルを維持)。
async function restart(opts: RestartPreviewOptions = {}) {
  busy.value = true;
  actionError.value = null;
  logs.value = [];
  try {
    const res = await props.actions.restart(opts);
    previewId.value = res.previewId;
    status.value = "building";
    connect(res.previewId);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "再起動に失敗しました";
  } finally {
    busy.value = false;
  }
}

// 「再起動」もボリューム破棄/トンネル破棄のチェックを適用する(issue #58)。
// キャッシュ破棄はビルド時のみ意味を持つため再起動では対象外。
function restartWithOpts() {
  void restart({
    resetVolumes: rebuildOpts.value.resetVolumes,
    resetTunnel: rebuildOpts.value.resetTunnel,
  });
}

onMounted(() => {
  if (previewId.value) connect(previewId.value);
});
onUnmounted(disconnect);
</script>

<template>
  <BaseCard>
    <div
      class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">{{ title ?? "プレビュー環境" }}</span>
        <PreviewStatusBadge :status="status" />
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
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
          <!-- 設定プロファイルの選択(issue #52)。再ビルドでもvolume/tunnelは維持される -->
          <label
            v-if="profiles && profiles.length > 0 && status !== 'paused'"
            class="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"
            title="ビルドに使う設定プロファイル。既定の設定を項目単位で上書きします"
          >
            プロファイル
            <select
              v-model="selectedProfileId"
              class="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">既定の設定</option>
              <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>

          <!-- 稼働中の再ビルドオプション(チェックボックスで選択。#20/#41/#42を1つの再ビルドに集約) -->
          <div
            v-if="status === 'running'"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300"
          >
            <label
              class="inline-flex items-center gap-1"
              title="ビルドキャッシュを破棄する(再ビルドのみ有効)"
            >
              <input
                v-model="rebuildOpts.noCache"
                type="checkbox"
                class="h-3.5 w-3.5 accent-blue-600"
              />
              キャッシュ破棄
            </label>
            <label
              class="inline-flex items-center gap-1"
              title="ボリューム(DB等)を破棄して初期化する(再ビルド/再起動どちらにも適用)"
            >
              <input
                v-model="rebuildOpts.resetVolumes"
                type="checkbox"
                class="h-3.5 w-3.5 accent-blue-600"
              />
              ボリューム破棄
            </label>
            <label
              class="inline-flex items-center gap-1"
              title="トンネル(URL)を破棄して再作成する(URLが変わる)。未チェックなら維持(再ビルド/再起動どちらにも適用)"
            >
              <input
                v-model="rebuildOpts.resetTunnel"
                type="checkbox"
                class="h-3.5 w-3.5 accent-blue-600"
              />
              トンネル破棄
            </label>
          </div>

          <!-- 一時停止からの再開(issue #32)。チェックボックス非表示のためオプションなし -->
          <BaseButton v-if="status === 'paused'" size="sm" :disabled="busy" @click="restart()">
            <Play class="h-4 w-4" />
            再開
          </BaseButton>
          <!-- 稼働中: チェックボックスで選んだオプションを付けて再ビルド -->
          <BaseButton v-else-if="status === 'running'" size="sm" :disabled="busy" @click="rebuild">
            <RotateCw class="h-4 w-4" />
            再ビルド
          </BaseButton>
          <!-- 未作成/停止/失敗: 起動 -->
          <BaseButton v-else size="sm" :disabled="busy" @click="start()">
            <Play class="h-4 w-4" />
            プレビューを起動
          </BaseButton>

          <!-- ビルドせず再起動。ボリューム破棄/トンネル破棄のチェックを適用する(issue #58) -->
          <BaseButton
            v-if="status === 'running'"
            size="sm"
            variant="secondary"
            :disabled="busy"
            title="ビルドせずコンテナを再起動します。ボリューム破棄/トンネル破棄のチェックが適用されます"
            @click="restartWithOpts"
          >
            <RotateCcw class="h-4 w-4" />
            再起動
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
        <!-- ビルドに使われた設定プロファイル(issue #52) -->
        <BaseBadge v-if="currentProfileName" tone="purple">
          プロファイル: {{ currentProfileName }}
        </BaseBadge>
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
