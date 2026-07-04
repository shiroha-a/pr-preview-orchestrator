<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Download, Loader2, Upload, X } from "lucide-vue-next";

import { api } from "../api/client";
import type { VolumeInfo } from "../api/client";

/**
 * Volume export/import dialog for a preview environment (issue #61). Exports
 * download as tar.gz; imports upload a tar.gz in chunks and run as a job whose
 * progress is streamed to the preview's log via SSE.
 */
const props = defineProps<{
  previewId: string;
  /** Current preview status; imports require the containers to be stopped. */
  status: string;
}>();
const emit = defineEmits<{ close: [] }>();

const loading = ref(true);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const volumes = ref<VolumeInfo[]>([]);

// インポート中のボリューム名と進捗(同時実行は1つに制限)。
const importing = ref<string | null>(null);
const progress = ref(0);

const fileInput = ref<HTMLInputElement | null>(null);
const pendingVolume = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    volumes.value = (await api.listPreviewVolumes(props.previewId)).volumes;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ボリューム一覧の取得に失敗しました";
  } finally {
    loading.value = false;
  }
}

function pickFile(volume: string) {
  pendingVolume.value = volume;
  fileInput.value?.click();
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 同じファイルを選び直せるようリセットする。
  input.value = "";
  const volume = pendingVolume.value;
  pendingVolume.value = null;
  if (!file || !volume) return;

  error.value = null;
  message.value = null;
  if (file.size === 0) {
    error.value = "空のファイルはインポートできません";
    return;
  }
  if (
    !confirm(
      `ボリューム「${volume}」の内容を、アップロードしたアーカイブで完全に置き換えます。よろしいですか?`,
    )
  ) {
    return;
  }

  importing.value = volume;
  progress.value = 0;
  try {
    await api.importPreviewVolume(props.previewId, volume, file, (sent, total) => {
      progress.value = Math.round((sent / total) * 100);
    });
    message.value =
      "アップロード完了。インポートジョブを開始しました。進捗はプレビューのログに表示されます。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "インポートに失敗しました";
  } finally {
    importing.value = null;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && !importing.value) emit("close");
}
onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  void load();
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="!importing && emit('close')"
  >
    <div class="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900">
      <div
        class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"
      >
        <span class="text-sm font-semibold">ボリュームのエクスポート/インポート</span>
        <button
          class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="閉じる"
          :disabled="!!importing"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-3 px-4 py-4">
        <p v-if="loading" class="flex items-center gap-1.5 text-sm text-gray-500">
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
          ボリュームを取得中...
        </p>
        <p v-else-if="volumes.length === 0" class="text-sm text-gray-500">
          このプレビューにボリュームはありません。
        </p>

        <template v-else>
          <p v-if="status === 'running'" class="text-xs text-amber-600 dark:text-amber-400">
            インポートは停止中のみ実行できます。先に「停止(保持)」を押してください。
          </p>
          <ul class="space-y-2">
            <li
              v-for="v in volumes"
              :key="v.name"
              class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800"
            >
              <div class="min-w-0">
                <code class="text-xs break-all">{{ v.name }}</code>
                <p class="mt-0.5 text-xs text-gray-500">
                  {{ v.sizeMb != null ? `${v.sizeMb} MB` : "サイズ不明" }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <a
                  :href="api.volumeExportUrl(previewId, v.name)"
                  class="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="ボリュームの内容をtar.gzでダウンロードします"
                >
                  <Download class="h-3.5 w-3.5" />
                  エクスポート
                </a>
                <button
                  class="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  :disabled="status === 'running' || !!importing"
                  title="tar.gzをアップロードしてボリュームの内容を置き換えます(停止中のみ)"
                  @click="pickFile(v.name)"
                >
                  <Loader2 v-if="importing === v.name" class="h-3.5 w-3.5 animate-spin" />
                  <Upload v-else class="h-3.5 w-3.5" />
                  インポート
                </button>
              </div>
            </li>
          </ul>
        </template>

        <div v-if="importing" class="space-y-1">
          <p class="text-xs text-gray-500">アップロード中... {{ progress }}%</p>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div class="h-full bg-blue-600 transition-all" :style="{ width: `${progress}%` }" />
          </div>
        </div>

        <p v-if="message" class="text-xs text-green-600 dark:text-green-400">{{ message }}</p>
        <p v-if="error" class="text-xs text-red-600">{{ error }}</p>

        <input
          ref="fileInput"
          type="file"
          accept=".tar.gz,.tgz,application/gzip"
          class="hidden"
          @change="onFileSelected"
        />
      </div>
    </div>
  </div>
</template>
