<script setup lang="ts">
import { Plus, Trash2 } from "lucide-vue-next";

import type { OverlayFile } from "../types";
import BaseButton from "./ui/BaseButton.vue";

// 既定設定とプロファイルの両方から使う共通エディタ(issue #52)。
const overlays = defineModel<OverlayFile[]>({ required: true });

function addOverlay() {
  overlays.value.push({ path: "", content: "" });
}
function removeOverlay(index: number) {
  overlays.value.splice(index, 1);
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
const textareaClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
</script>

<template>
  <div>
    <div class="mb-1 flex items-center justify-end">
      <BaseButton type="button" variant="secondary" size="sm" @click="addOverlay">
        <Plus class="h-4 w-4" />
        ファイルを追加
      </BaseButton>
    </div>
    <p v-if="overlays.length === 0" class="text-xs text-gray-400">ファイルはありません。</p>
    <div
      v-for="(o, i) in overlays"
      :key="i"
      class="mb-2 space-y-2 rounded-md border border-gray-200 p-2 dark:border-gray-700"
    >
      <div class="flex items-center gap-2">
        <input
          v-model="o.path"
          :class="inputClass"
          placeholder="docker-compose.preview.yml(配置先パス)"
        />
        <BaseButton type="button" variant="ghost" size="sm" @click="removeOverlay(i)">
          <Trash2 class="h-4 w-4" />
        </BaseButton>
      </div>
      <textarea
        v-model="o.content"
        :class="textareaClass"
        rows="6"
        placeholder="ファイルの内容..."
      ></textarea>
    </div>
  </div>
</template>
