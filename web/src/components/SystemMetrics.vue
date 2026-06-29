<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import { api } from "../api/client";
import type { SystemMetrics } from "../types";
import BaseCard from "./ui/BaseCard.vue";

const metrics = ref<SystemMetrics | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
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

        <div
          v-if="metrics.containers.length > 0"
          class="border-t border-gray-100 pt-2 dark:border-gray-800"
        >
          <div class="mb-1 text-xs font-medium text-gray-500">
            プレビューコンテナ ({{ metrics.containers.length }})
          </div>
          <div class="space-y-1">
            <div
              v-for="cont in metrics.containers"
              :key="cont.name"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <code class="truncate text-gray-600 dark:text-gray-300">{{ cont.name }}</code>
              <span class="shrink-0 text-gray-500">
                CPU {{ cont.cpu }} ・ MEM {{ cont.memUsage }}
              </span>
            </div>
          </div>
        </div>
      </template>

      <!-- 読み込み中: メモリ/ディスク行と同じ高さのプレースホルダで枠を固定する。 -->
      <template v-else>
        <div v-for="n in 2" :key="n" class="space-y-1" aria-hidden="true">
          <div class="h-4 w-1/3 rounded bg-gray-100 dark:bg-gray-800"></div>
          <div class="h-2 rounded-full bg-gray-100 dark:bg-gray-800"></div>
        </div>
      </template>
    </div>
  </BaseCard>
</template>
