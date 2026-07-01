<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Trash2 } from "lucide-vue-next";

import { api } from "../api/client";
import type { SystemMetrics } from "../types";
import BaseCard from "./ui/BaseCard.vue";

const metrics = ref<SystemMetrics | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
// プレビュー合計メモリの表示(1GiB以上はGiB、未満はMiB)。
function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}
function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}
function barColor(p: number): string {
  if (p >= 90) return "bg-red-500";
  if (p >= 75) return "bg-amber-500";
  return "bg-blue-500";
}

const memPct = computed(() =>
  metrics.value ? pct(metrics.value.memory.used, metrics.value.memory.total) : 0,
);
const swapPct = computed(() =>
  metrics.value ? pct(metrics.value.swap.used, metrics.value.swap.total) : 0,
);
const diskPct = computed(() =>
  metrics.value ? pct(metrics.value.disk.used, metrics.value.disk.total) : 0,
);

async function load() {
  try {
    metrics.value = await api.getMetrics();
  } catch {
    // 一時的なエラーは無視(次のポーリングで回復)
  }
}

const pruning = ref(false);
const pruneResult = ref<string | null>(null);
const pruneError = ref<string | null>(null);

// Dockerビルドキャッシュを全削除する(ホスト全体・全プロジェクト共通。issue #20)。
async function pruneCache() {
  if (!confirm("Dockerのビルドキャッシュを削除しますか?(ホスト全体に影響します)")) return;
  pruning.value = true;
  pruneResult.value = null;
  pruneError.value = null;
  try {
    const { output } = await api.pruneBuilderCache();
    // 出力末尾の "Total reclaimed space: ..." 行を要約として表示する。
    const summary = output.split("\n").filter(Boolean).pop();
    pruneResult.value = summary ?? "ビルドキャッシュを削除しました";
    await load();
  } catch (e) {
    pruneError.value = e instanceof Error ? e.message : "削除に失敗しました";
  } finally {
    pruning.value = false;
  }
}

onMounted(() => {
  void load();
  // 5秒ごとに更新(リアルタイム表示)
  timer = setInterval(load, 5000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <!-- データ未取得でもカードを表示し、レイアウトシフト(誤操作の原因)を防ぐ。 -->
  <BaseCard>
    <div class="space-y-3 p-4">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">システム使用状況</span>
        <span v-if="metrics" class="text-xs text-gray-400">
          load: {{ metrics.loadavg.map((l) => l.toFixed(2)).join(" / ") }}
        </span>
      </div>

      <template v-if="metrics">
        <div>
          <div class="mb-1 flex justify-between text-xs text-gray-500">
            <span>メモリ</span>
            <span>
              {{ gb(metrics.memory.used) }} / {{ gb(metrics.memory.total) }} GB ({{ memPct }}%)
            </span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              :class="['h-full transition-all', barColor(memPct)]"
              :style="{ width: memPct + '%' }"
            />
          </div>
        </div>

        <!-- スワップ(issue #39)。未設定ホストは「なし」表示だが行は常に描画し、
             ローディングのスケルトンと高さを揃えてレイアウトシフトを防ぐ(408f88c 回帰対策)。 -->
        <div>
          <div class="mb-1 flex justify-between text-xs text-gray-500">
            <span>スワップ</span>
            <span v-if="metrics.swap.total > 0">
              {{ gb(metrics.swap.used) }} / {{ gb(metrics.swap.total) }} GB ({{ swapPct }}%)
            </span>
            <span v-else>なし</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              :class="['h-full transition-all', barColor(swapPct)]"
              :style="{ width: swapPct + '%' }"
            />
          </div>
        </div>

        <div>
          <div class="mb-1 flex justify-between text-xs text-gray-500">
            <span>ディスク (/)</span>
            <span>
              {{ gb(metrics.disk.used) }} / {{ gb(metrics.disk.total) }} GB ({{ diskPct }}%)
            </span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              :class="['h-full transition-all', barColor(diskPct)]"
              :style="{ width: diskPct + '%' }"
            />
          </div>
        </div>

        <!-- 件数で高さが変わるため既定で折りたたみ、見出しのみ常時表示して高さを固定する。 -->
        <!-- プレビュー単位でCPU/メモリを合算表示(コンテナ毎の重複を排除)。 -->
        <details class="border-t border-gray-100 pt-2 dark:border-gray-800">
          <summary class="cursor-pointer text-xs font-medium text-gray-500 select-none">
            プレビュー ({{ metrics.previews.length }})
          </summary>
          <div class="mt-2 space-y-1">
            <p v-if="metrics.previews.length === 0" class="text-xs text-gray-400">
              稼働中のプレビューはありません。
            </p>
            <!-- PR(プレビュー)毎にさらに折りたたみ、展開で個別コンテナを表示する(2重折りたたみ)。 -->
            <details v-for="pv in metrics.previews" :key="pv.label">
              <summary
                class="cursor-pointer text-xs text-gray-600 select-none marker:text-gray-400 dark:text-gray-300"
              >
                {{ pv.label }}
                <span class="text-gray-400">×{{ pv.containers.length }}</span>
                <span class="text-gray-500">
                  ・ CPU {{ pv.cpu.toFixed(1) }}% ・ MEM {{ fmtBytes(pv.memBytes) }}
                </span>
              </summary>
              <div class="mt-1 space-y-0.5 pl-4">
                <div
                  v-for="c in pv.containers"
                  :key="c.name"
                  class="flex items-center justify-between gap-2 text-xs text-gray-500"
                >
                  <code class="truncate">{{ c.name }}</code>
                  <span class="shrink-0">
                    CPU {{ c.cpu.toFixed(1) }}% ・ MEM {{ fmtBytes(c.memBytes) }}
                  </span>
                </div>
              </div>
            </details>
          </div>
        </details>
      </template>

      <!-- 読み込み中: メモリ/スワップ/ディスクの3行と同じ高さのプレースホルダで枠を固定する。 -->
      <template v-else>
        <div v-for="n in 3" :key="n" class="space-y-1" aria-hidden="true">
          <div class="h-4 w-1/3 rounded bg-gray-100 dark:bg-gray-800"></div>
          <div class="h-2 rounded-full bg-gray-100 dark:bg-gray-800"></div>
        </div>
        <div class="border-t border-gray-100 pt-2 dark:border-gray-800" aria-hidden="true">
          <div class="h-4 w-1/3 rounded bg-gray-100 dark:bg-gray-800"></div>
        </div>
      </template>

      <!-- Dockerビルドキャッシュの手動削除(issue #20)。 -->
      <div
        class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 dark:border-gray-800"
      >
        <button
          class="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          :disabled="pruning"
          @click="pruneCache"
        >
          <Trash2 class="h-3.5 w-3.5" />
          {{ pruning ? "削除中..." : "ビルドキャッシュを削除" }}
        </button>
        <span v-if="pruneResult" class="text-xs text-green-600">{{ pruneResult }}</span>
        <span v-if="pruneError" class="text-xs text-red-600">{{ pruneError }}</span>
      </div>
    </div>
  </BaseCard>
</template>
