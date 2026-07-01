<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Plus, X } from "lucide-vue-next";

import { api } from "../api/client";
import BaseButton from "./ui/BaseButton.vue";

const emit = defineEmits<{ close: []; added: [] }>();

const repoInput = ref("");
const adding = ref(false);
const error = ref<string | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

async function submit() {
  error.value = null;
  const [owner, name] = repoInput.value.trim().split("/");
  if (!owner || !name) {
    error.value = "owner/name の形式で入力してください(例: vercel/next.js)";
    return;
  }
  adding.value = true;
  try {
    await api.addRepository(owner, name);
    emit("added");
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "追加に失敗しました";
  } finally {
    adding.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  inputEl.value?.focus();
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900">
      <div
        class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"
      >
        <span class="text-sm font-semibold">リポジトリを追加</span>
        <button
          class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="閉じる"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
      <form class="space-y-3 px-4 py-4" @submit.prevent="submit">
        <div>
          <label class="mb-1 block text-sm font-medium">リポジトリ(owner/name)</label>
          <input
            ref="inputEl"
            v-model="repoInput"
            class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
            placeholder="vercel/next.js"
          />
          <p class="mt-1 text-xs text-gray-500">
            公開リポジトリを追加できます(privateは任意トークン設定時のみ)。
          </p>
        </div>
        <div class="flex items-center justify-end gap-3">
          <span v-if="error" class="text-xs text-red-600">{{ error }}</span>
          <BaseButton type="button" variant="secondary" :disabled="adding" @click="emit('close')">
            キャンセル
          </BaseButton>
          <BaseButton type="submit" :disabled="adding">
            <Plus class="h-4 w-4" />
            {{ adding ? "追加中..." : "追加" }}
          </BaseButton>
        </div>
      </form>
    </div>
  </div>
</template>
