<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Download, Plus, Trash2, Upload } from "lucide-vue-next";

import { api } from "../api/client";
import type { OverlayFile, RewriteRule } from "../types";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";

const route = useRoute();
const router = useRouter();
const owner = route.params.owner as string;
const name = route.params.name as string;

const loading = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const saved = ref(false);
const deleting = ref(false);

const composePath = ref("docker-compose.yml");
const webService = ref("");
const internalPort = ref("");
const resetVolumes = ref(false);
const rules = ref<RewriteRule[]>([]);
const overlays = ref<OverlayFile[]>([]);

// {{ }} は Vue の補間と衝突するため定数経由でプレースホルダ/ヒントを表示する。
const patternPlaceholder = "^url:.*";
const replacementPlaceholder = "url: {{PREVIEW_URL}}";
const varsHint = "{{PREVIEW_URL}} / {{PREVIEW_HOST}} / {{HOST_PORT}}";

function parseJsonArray<T>(value: string | null): T[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const { repository } = await api.getRepo(owner, name);
    composePath.value = repository.composePath;
    webService.value = repository.webService ?? "";
    internalPort.value = repository.internalPort != null ? String(repository.internalPort) : "";
    resetVolumes.value = repository.resetVolumes;
    rules.value = parseJsonArray<RewriteRule>(repository.fileRewrites);
    overlays.value = parseJsonArray<OverlayFile>(repository.overlayFiles);
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
function addOverlay() {
  overlays.value.push({ path: "", content: "" });
}
function removeOverlay(index: number) {
  overlays.value.splice(index, 1);
}

function currentSettings() {
  return {
    composePath: composePath.value.trim() || "docker-compose.yml",
    webService: webService.value.trim() || null,
    internalPort: internalPort.value ? Number(internalPort.value) : null,
    fileRewrites: rules.value.filter((r) => r.file.trim() && r.pattern.trim()),
    overlayFiles: overlays.value.filter((o) => o.path.trim()),
    resetVolumes: resetVolumes.value,
  };
}

async function save() {
  saving.value = true;
  error.value = null;
  saved.value = false;
  try {
    await api.updateRepoSettings(owner, name, currentSettings());
    saved.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存に失敗しました";
  } finally {
    saving.value = false;
  }
}

// --- 設定のエクスポート / インポート(issue #13) ---
function exportSettings() {
  const blob = new Blob([JSON.stringify(currentSettings(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${owner}-${name}-preview-settings.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSettings(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as Record<string, unknown>;
      if (typeof data.composePath === "string") composePath.value = data.composePath;
      webService.value = typeof data.webService === "string" ? data.webService : "";
      internalPort.value = data.internalPort != null ? String(data.internalPort as number) : "";
      resetVolumes.value = Boolean(data.resetVolumes);
      rules.value = Array.isArray(data.fileRewrites) ? (data.fileRewrites as RewriteRule[]) : [];
      overlays.value = Array.isArray(data.overlayFiles) ? (data.overlayFiles as OverlayFile[]) : [];
      saved.value = false;
      error.value = null;
    } catch {
      error.value = "インポートに失敗しました(JSONを確認してください)";
    }
  };
  reader.readAsText(file);
  input.value = "";
}

// --- リポジトリの削除(issue #12) ---
async function deleteRepo() {
  if (
    !window.confirm(
      `${owner}/${name} を管理対象から削除します。プレビュー環境(コンテナ・workspace)も破棄されます。よろしいですか?`,
    )
  ) {
    return;
  }
  deleting.value = true;
  error.value = null;
  try {
    await api.deleteRepository(owner, name);
    await router.push("/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "削除に失敗しました";
    deleting.value = false;
  }
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
const textareaClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900";
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
            clone後・起動前に既存ファイルを正規表現で書き換えます。置換文字列で
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

        <div>
          <div class="mb-1 flex items-center justify-between">
            <label class="text-sm font-medium">オーバーレイファイル</label>
            <BaseButton type="button" variant="secondary" size="sm" @click="addOverlay">
              <Plus class="h-4 w-4" />
              ファイルを追加
            </BaseButton>
          </div>
          <p class="mb-2 text-xs text-gray-500">
            対象リポジトリ外で用意したファイル(テスト用 compose / 設定 / volumes 等)を clone
            先に配置します。内容で <code>{{ varsHint }}</code> が使えます。
          </p>
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

        <label class="flex items-start gap-2 text-sm">
          <input v-model="resetVolumes" type="checkbox" class="mt-0.5 h-4 w-4" />
          <span> 起動のたびにDockerボリュームを初期化する(DB・ファイル等をリセット) </span>
        </label>

        <div class="flex flex-wrap items-center justify-end gap-3">
          <label
            class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Upload class="h-4 w-4" />
            インポート
            <input type="file" accept="application/json" class="hidden" @change="importSettings" />
          </label>
          <BaseButton type="button" variant="secondary" size="sm" @click="exportSettings">
            <Download class="h-4 w-4" />
            エクスポート
          </BaseButton>
          <span v-if="saved" class="text-xs text-green-600">保存しました</span>
          <span v-if="error" class="text-xs text-red-600">{{ error }}</span>
          <BaseButton type="submit" :disabled="saving">
            {{ saving ? "保存中..." : "保存" }}
          </BaseButton>
        </div>
      </form>
    </BaseCard>

    <BaseCard v-if="!loading" class="border-red-200 dark:border-red-900/50">
      <div class="flex items-center justify-between gap-3 p-4">
        <div class="text-sm">
          <p class="font-medium text-red-700 dark:text-red-400">リポジトリを削除</p>
          <p class="mt-0.5 text-xs text-gray-500">
            プレビュー環境(コンテナ・workspace)とすべての設定・キャッシュを削除し、管理対象から外します。
          </p>
        </div>
        <BaseButton variant="danger" size="sm" :disabled="deleting" @click="deleteRepo">
          <Trash2 class="h-4 w-4" />
          {{ deleting ? "削除中..." : "削除" }}
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
