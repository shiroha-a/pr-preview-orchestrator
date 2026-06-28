<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Plus, Trash2 } from "lucide-vue-next";

import { api } from "../api/client";
import type { RewriteRule } from "../types";
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
const resetVolumes = ref(false);
const rules = ref<RewriteRule[]>([]);

// {{ }} は Vue の補間と衝突するため定数経由でプレースホルダ/ヒントを表示する。
const patternPlaceholder = "^url:.*";
const replacementPlaceholder = "url: {{PREVIEW_URL}}";
const varsHint = "{{PREVIEW_URL}} / {{PREVIEW_HOST}} / {{HOST_PORT}}";

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const { repository } = await api.getRepo(owner, name);
    composePath.value = repository.composePath;
    webService.value = repository.webService ?? "";
    internalPort.value = repository.internalPort != null ? String(repository.internalPort) : "";
    resetVolumes.value = repository.resetVolumes;
    try {
      const parsed: unknown = repository.fileRewrites ? JSON.parse(repository.fileRewrites) : [];
      rules.value = Array.isArray(parsed) ? (parsed as RewriteRule[]) : [];
    } catch {
      rules.value = [];
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function addRule() {
  rules.value.push({ file: "", pattern: "", replacement: "" });
}

function removeRule(index: number) {
  rules.value.splice(index, 1);
}

async function save() {
  saving.value = true;
  error.value = null;
  saved.value = false;
  try {
    await api.updateRepoSettings(owner, name, {
      composePath: composePath.value.trim() || "docker-compose.yml",
      webService: webService.value.trim() || null,
      internalPort: internalPort.value ? Number(internalPort.value) : null,
      fileRewrites: rules.value.filter((r) => r.file.trim() && r.pattern.trim()),
      resetVolumes: resetVolumes.value,
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
      <form class="space-y-5 p-4" @submit.prevent="save">
        <div>
          <label class="mb-1 block text-sm font-medium">Composeファイルのパス</label>
          <input v-model="composePath" :class="inputClass" placeholder="docker-compose.yml" />
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

        <div>
          <div class="mb-1 flex items-center justify-between">
            <label class="text-sm font-medium">ファイル書き換えルール</label>
            <BaseButton type="button" variant="secondary" size="sm" @click="addRule">
              <Plus class="h-4 w-4" />
              ルールを追加
            </BaseButton>
          </div>
          <p class="mb-2 text-xs text-gray-500">
            clone後・起動前に対象ファイルを正規表現で書き換えます。置換文字列で
            <code>{{ varsHint }}</code> が使えます。
          </p>
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
            <input
              v-model="rule.replacement"
              :class="inputClass"
              :placeholder="replacementPlaceholder"
            />
          </div>
        </div>

        <label class="flex items-start gap-2 text-sm">
          <input v-model="resetVolumes" type="checkbox" class="mt-0.5 h-4 w-4" />
          <span> 起動のたびにDockerボリュームを初期化する(DB・ファイル等をリセット) </span>
        </label>

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
