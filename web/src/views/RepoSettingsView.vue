<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { api } from "../api/client";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const route = useRoute();
const owner = route.params.owner as string;
const name = route.params.name as string;

const loading = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const saved = ref(false);

const composePath = ref("docker-compose.yml");
const webService = ref("");
const internalPort = ref("");

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const { repository } = await api.getRepo(owner, name);
    composePath.value = repository.composePath;
    webService.value = repository.webService ?? "";
    internalPort.value = repository.internalPort != null ? String(repository.internalPort) : "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function save() {
  saving.value = true;
  error.value = null;
  saved.value = false;
  try {
    await api.updateRepoSettings(owner, name, {
      composePath: composePath.value.trim() || "docker-compose.yml",
      webService: webService.value.trim() || null,
      internalPort: internalPort.value ? Number(internalPort.value) : null,
    });
    saved.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存に失敗しました";
  } finally {
    saving.value = false;
  }
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
</script>

<template>
  <div class="space-y-6">
    <div>
      <RouterLink :to="`/repos/${owner}/${name}`" class="text-xs text-gray-500 hover:underline">
        ← {{ owner }}/{{ name }}
      </RouterLink>
      <h1 class="mt-1 text-xl font-semibold">プレビュー設定</h1>
      <p class="mt-1 text-sm text-gray-500">
        このリポジトリのプレビュー環境を起動する際の設定です。
      </p>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">読み込み中...</p>

    <BaseCard v-else>
      <form class="space-y-4 p-4" @submit.prevent="save">
        <div>
          <label class="mb-1 block text-sm font-medium">Composeファイルのパス</label>
          <input v-model="composePath" :class="inputClass" placeholder="docker-compose.yml" />
          <p class="mt-1 text-xs text-gray-500">
            リポジトリルートからの相対パス。プレビュー起動時に
            <code>docker compose</code> が使います。
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">公開Webサービス名</label>
          <input v-model="webService" :class="inputClass" placeholder="web" />
          <p class="mt-1 text-xs text-gray-500">
            ブラウザで開くサービス名(compose内のサービス名)。
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">内部ポート</label>
          <input
            v-model="internalPort"
            :class="inputClass"
            inputmode="numeric"
            placeholder="3000"
          />
          <p class="mt-1 text-xs text-gray-500">上記サービスがコンテナ内でListenするポート番号。</p>
        </div>

        <div class="flex items-center justify-end gap-3">
          <span v-if="saved" class="text-xs text-green-600">保存しました</span>
          <span v-if="error" class="text-xs text-red-600">{{ error }}</span>
          <BaseButton type="submit" :disabled="saving">
            {{ saving ? "保存中..." : "保存" }}
          </BaseButton>
        </div>
      </form>
    </BaseCard>
  </div>
</template>
