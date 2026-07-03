<script setup lang="ts">
import { Plus, Trash2 } from "lucide-vue-next";

import type { RewriteRule } from "../types";
import BaseButton from "./ui/BaseButton.vue";

// 既定設定とプロファイルの両方から使う共通エディタ(issue #52)。
const rules = defineModel<RewriteRule[]>({ required: true });

// {{ }} は Vue の補間と衝突するため定数経由でプレースホルダを表示する。
const patternPlaceholder = "^url:.*";
const replacementPlaceholder = "url: {{PREVIEW_URL}}";

function addRule() {
  rules.value.push({ file: "", pattern: "", replacement: "" });
}
function removeRule(index: number) {
  rules.value.splice(index, 1);
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
</script>

<template>
  <div>
    <div class="mb-1 flex items-center justify-end">
      <BaseButton type="button" variant="secondary" size="sm" @click="addRule">
        <Plus class="h-4 w-4" />
        ルールを追加
      </BaseButton>
    </div>
    <p v-if="rules.length === 0" class="text-xs text-gray-400">ルールはありません。</p>
    <div
      v-for="(rule, i) in rules"
      :key="i"
      class="mb-2 space-y-2 rounded-md border border-gray-200 p-2 dark:border-gray-700"
    >
      <div class="flex items-center gap-2">
        <input
          v-model="rule.file"
          :class="inputClass"
          placeholder=".config/default.yml(対象ファイル)"
        />
        <BaseButton type="button" variant="ghost" size="sm" @click="removeRule(i)">
          <Trash2 class="h-4 w-4" />
        </BaseButton>
      </div>
      <input v-model="rule.pattern" :class="inputClass" :placeholder="patternPlaceholder" />
      <input v-model="rule.replacement" :class="inputClass" :placeholder="replacementPlaceholder" />
    </div>
  </div>
</template>
