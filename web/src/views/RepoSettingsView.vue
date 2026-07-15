<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Download, Plus, Trash2, Upload } from "lucide-vue-next";

import { api } from "../api/client";
import type { ProfileInput } from "../api/client";
import type {
  BuildMode,
  OverlayFile,
  ProfileOverlayEntry,
  RewriteRule,
  SettingsProfileDTO,
} from "../types";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import OverlayFilesEditor from "../components/OverlayFilesEditor.vue";
import RewriteRulesEditor from "../components/RewriteRulesEditor.vue";

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
// 空文字=グローバル既定(BUILD_MODE_DEFAULT)を継承する(issue #80)。
const buildMode = ref<BuildMode | "">("");
const rules = ref<RewriteRule[]>([]);
const overlays = ref<OverlayFile[]>([]);

/**
 * Editable form state for one settings profile. Each `overrides.*` flag maps to
 * a nullable API field: unchecked = null = inherit the repository default
 * (issue #52). Overlay files are additive over the defaults: `overlays` holds
 * added/replaced files and `deletePaths` the default paths to drop (issue #56).
 */
interface ProfileForm {
  id: string | null;
  name: string;
  overrides: {
    composePath: boolean;
    webService: boolean;
    internalPort: boolean;
    fileRewrites: boolean;
    overlayFiles: boolean;
    resetVolumes: boolean;
    buildMode: boolean;
  };
  composePath: string;
  webService: string;
  internalPort: string;
  resetVolumes: boolean;
  buildMode: BuildMode;
  rules: RewriteRule[];
  overlays: OverlayFile[];
  deletePaths: string[];
}

const profiles = ref<ProfileForm[]>([]);

// {{ }} は Vue の補間と衝突するため定数経由でヒントを表示する。
const varsHint = "{{PREVIEW_URL}} / {{PREVIEW_HOST}} / {{HOST_PORT}}";

function parseJsonArray<T>(value: string | null): T[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function profileFormFromDTO(dto: SettingsProfileDTO): ProfileForm {
  // オーバーレイは既定への差分(追加/上書きとdelete指定)として保持する(issue #56)。
  const overlayEntries = parseJsonArray<ProfileOverlayEntry>(dto.overlayFiles);
  return {
    id: dto.id,
    name: dto.name,
    overrides: {
      composePath: dto.composePath != null,
      webService: dto.webService != null,
      internalPort: dto.internalPort != null,
      fileRewrites: dto.fileRewrites != null,
      overlayFiles: dto.overlayFiles != null,
      resetVolumes: dto.resetVolumes != null,
      buildMode: dto.buildMode != null,
    },
    // 未上書きの項目は現在の既定値を初期表示し、チェック時にそこから編集できるようにする。
    composePath: dto.composePath ?? composePath.value,
    webService: dto.webService ?? webService.value,
    internalPort: dto.internalPort != null ? String(dto.internalPort) : internalPort.value,
    resetVolumes: dto.resetVolumes ?? resetVolumes.value,
    buildMode: dto.buildMode ?? (buildMode.value || "auto"),
    rules:
      dto.fileRewrites != null
        ? parseJsonArray<RewriteRule>(dto.fileRewrites)
        : rules.value.map((r) => ({ ...r })),
    overlays: overlayEntries
      .filter((e) => !e.delete)
      .map((e) => ({ path: e.path, content: e.content ?? "" })),
    deletePaths: overlayEntries.filter((e) => e.delete).map((e) => e.path),
  };
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
    buildMode.value = repository.buildMode ?? "";
    rules.value = parseJsonArray<RewriteRule>(repository.fileRewrites);
    overlays.value = parseJsonArray<OverlayFile>(repository.overlayFiles);
    profiles.value = (repository.profiles ?? []).map(profileFormFromDTO);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "読み込みに失敗しました";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function addProfile() {
  profiles.value.push({
    id: null,
    name: "",
    overrides: {
      composePath: false,
      webService: false,
      internalPort: false,
      fileRewrites: false,
      overlayFiles: false,
      resetVolumes: false,
      buildMode: false,
    },
    composePath: composePath.value,
    webService: webService.value,
    internalPort: internalPort.value,
    resetVolumes: resetVolumes.value,
    buildMode: buildMode.value || "auto",
    rules: rules.value.map((r) => ({ ...r })),
    // オーバーレイは既定への追加方式なので空から始める(issue #56)。
    overlays: [],
    deletePaths: [],
  });
}
function removeProfile(index: number) {
  profiles.value.splice(index, 1);
}

// --- プロファイルのオーバーレイ削除指定(issue #56) ---

/** 削除チェックボックスに表示するパス一覧(既定のパス+保存済みの削除指定)。 */
function overlayDeleteCandidates(p: ProfileForm): string[] {
  const paths = overlays.value.map((o) => o.path.trim()).filter(Boolean);
  for (const path of p.deletePaths) {
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

function toggleOverlayDelete(p: ProfileForm, path: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  if (checked) {
    if (!p.deletePaths.includes(path)) p.deletePaths.push(path);
  } else {
    p.deletePaths = p.deletePaths.filter((x) => x !== path);
  }
}

function toProfileInput(p: ProfileForm): ProfileInput {
  return {
    ...(p.id ? { id: p.id } : {}),
    name: p.name.trim(),
    composePath: p.overrides.composePath ? p.composePath.trim() || "docker-compose.yml" : null,
    webService: p.overrides.webService ? p.webService.trim() || null : null,
    internalPort: p.overrides.internalPort && p.internalPort ? Number(p.internalPort) : null,
    fileRewrites: p.overrides.fileRewrites
      ? p.rules.filter((r) => r.file.trim() && r.pattern.trim())
      : null,
    // 追加/上書きエントリ+delete指定を1つの配列にまとめる(issue #56)。
    overlayFiles: p.overrides.overlayFiles
      ? [
          ...p.overlays
            .filter((o) => o.path.trim())
            .map((o) => ({ path: o.path, content: o.content })),
          ...p.deletePaths.map((path) => ({ path, delete: true })),
        ]
      : null,
    resetVolumes: p.overrides.resetVolumes ? p.resetVolumes : null,
    buildMode: p.overrides.buildMode ? p.buildMode : null,
  };
}

function currentSettings() {
  return {
    composePath: composePath.value.trim() || "docker-compose.yml",
    webService: webService.value.trim() || null,
    internalPort: internalPort.value ? Number(internalPort.value) : null,
    fileRewrites: rules.value.filter((r) => r.file.trim() && r.pattern.trim()),
    overlayFiles: overlays.value.filter((o) => o.path.trim()),
    resetVolumes: resetVolumes.value,
    buildMode: buildMode.value || null,
    // 名前空欄のプロファイルも除外せず送る(保存前のバリデーションで弾く。issue #54)。
    profiles: profiles.value.map(toProfileInput),
  };
}

async function save() {
  saving.value = true;
  error.value = null;
  saved.value = false;
  // 名前空欄のプロファイルを無言で捨てると、同期削除で「保存したつもりが消えた」に
  // なるため、保存せずエラーで知らせる(issue #54)。
  if (profiles.value.some((p) => !p.name.trim())) {
    error.value =
      "プロファイル名が空欄です。名前を入力するか、不要なプロファイルは削除してください。";
    saving.value = false;
    return;
  }
  try {
    const { repository } = await api.updateRepoSettings(owner, name, currentSettings());
    // 新規プロファイルに採番されたidを反映する(再保存時の重複作成を防ぐ)。
    profiles.value = (repository.profiles ?? []).map(profileFormFromDTO);
    saved.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存に失敗しました";
  } finally {
    saving.value = false;
  }
}

// --- 設定のエクスポート / インポート(issue #13) ---
function exportSettings() {
  // idはこのDB固有のため、他環境へ持ち出すエクスポートには含めない。
  const settings = currentSettings();
  const exported = {
    ...settings,
    profiles: settings.profiles.map(({ id: _id, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(exported, null, 2)], {
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
      buildMode.value =
        data.buildMode === "auto" || data.buildMode === "remote" || data.buildMode === "local"
          ? data.buildMode
          : "";
      rules.value = Array.isArray(data.fileRewrites) ? (data.fileRewrites as RewriteRule[]) : [];
      overlays.value = Array.isArray(data.overlayFiles) ? (data.overlayFiles as OverlayFile[]) : [];
      profiles.value = Array.isArray(data.profiles)
        ? (data.profiles as ProfileInput[]).map((p) =>
            profileFormFromDTO({
              id: "",
              repositoryId: "",
              name: typeof p.name === "string" ? p.name : "",
              composePath: p.composePath ?? null,
              webService: p.webService ?? null,
              internalPort: p.internalPort ?? null,
              fileRewrites: p.fileRewrites != null ? JSON.stringify(p.fileRewrites) : null,
              overlayFiles: p.overlayFiles != null ? JSON.stringify(p.overlayFiles) : null,
              resetVolumes: p.resetVolumes ?? null,
              buildMode: p.buildMode ?? null,
              createdAt: "",
              updatedAt: "",
            }),
          )
        : [];
      // インポートしたプロファイルは新規作成として保存する。
      for (const p of profiles.value) p.id = null;
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
          <textarea
            v-model="composePath"
            :class="textareaClass"
            rows="2"
            placeholder="docker-compose.yml"
          ></textarea>
          <p class="mt-1 text-xs text-gray-500">
            1行に1ファイル。複数指定すると<code>docker compose -f</code
            >に連結され、後のファイルが前の定義を上書きします。
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

        <div>
          <label class="mb-1 block text-sm font-medium">ファイル書き換えルール</label>
          <p class="mb-2 text-xs text-gray-500">
            clone後・起動前に既存ファイルを正規表現で書き換えます。置換文字列で
            <code>{{ varsHint }}</code> が使えます。
          </p>
          <RewriteRulesEditor v-model="rules" />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">オーバーレイファイル</label>
          <p class="mb-2 text-xs text-gray-500">
            対象リポジトリ外で用意したファイル(テスト用 compose / 設定 / volumes 等)を clone
            先に配置します。内容で <code>{{ varsHint }}</code> が使えます。
          </p>
          <OverlayFilesEditor v-model="overlays" />
        </div>

        <label class="flex items-start gap-2 text-sm">
          <input v-model="resetVolumes" type="checkbox" class="mt-0.5 h-4 w-4" />
          <span> 起動のたびにDockerボリュームを初期化する(DB・ファイル等をリセット) </span>
        </label>

        <div>
          <label class="mb-1 block text-sm font-medium">ビルドモード</label>
          <select v-model="buildMode" :class="inputClass">
            <option value="">既定(グローバル設定に従う)</option>
            <option value="auto">
              auto: 外部ビルドサーバーがオンラインなら委譲、なければローカル
            </option>
            <option value="remote">remote: 常に外部ビルドサーバー(不在時は失敗)</option>
            <option value="local">local: 常にローカルでビルド</option>
          </select>
          <p class="mt-1 text-xs text-gray-500">
            Dockerイメージのビルドを外部ビルドサーバーへ委譲するかどうか(issue
            #80)。ビルドサーバーは設定画面で登録できます。
          </p>
        </div>

        <!-- 設定プロファイル(issue #52): チェックした項目だけ既定を上書きする -->
        <div class="border-t border-gray-100 pt-4 dark:border-gray-800">
          <div class="mb-1 flex items-center justify-between">
            <label class="text-sm font-medium">プロファイル</label>
            <BaseButton type="button" variant="secondary" size="sm" @click="addProfile">
              <Plus class="h-4 w-4" />
              プロファイルを追加
            </BaseButton>
          </div>
          <p class="mb-2 text-xs text-gray-500">
            既定の設定を項目単位で上書きする名前付きプロファイルです。プレビューの起動/再ビルド時に選択できます。チェックしていない項目は既定の設定を使います。
          </p>
          <p v-if="profiles.length === 0" class="text-xs text-gray-400">
            プロファイルはありません。
          </p>
          <div
            v-for="(p, i) in profiles"
            :key="p.id ?? `new-${i}`"
            class="mb-3 space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-700"
          >
            <div class="flex items-center gap-2">
              <input
                v-model="p.name"
                :class="inputClass"
                placeholder="プロファイル名(例: 検索あり)"
              />
              <BaseButton type="button" variant="ghost" size="sm" @click="removeProfile(i)">
                <Trash2 class="h-4 w-4" />
              </BaseButton>
            </div>

            <div class="space-y-3 text-sm">
              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.composePath" type="checkbox" class="h-4 w-4" />
                  Composeファイルのパスを上書き
                </label>
                <textarea
                  v-if="p.overrides.composePath"
                  v-model="p.composePath"
                  :class="[textareaClass, 'mt-2']"
                  rows="2"
                  placeholder="docker-compose.yml&#10;docker-compose.search.yml"
                ></textarea>
              </div>

              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.webService" type="checkbox" class="h-4 w-4" />
                  公開Webサービス名を上書き
                </label>
                <input
                  v-if="p.overrides.webService"
                  v-model="p.webService"
                  :class="[inputClass, 'mt-2']"
                  placeholder="web"
                />
              </div>

              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.internalPort" type="checkbox" class="h-4 w-4" />
                  内部ポートを上書き
                </label>
                <input
                  v-if="p.overrides.internalPort"
                  v-model="p.internalPort"
                  :class="[inputClass, 'mt-2']"
                  inputmode="numeric"
                  placeholder="3000"
                />
              </div>

              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.fileRewrites" type="checkbox" class="h-4 w-4" />
                  ファイル書き換えルールを上書き
                </label>
                <div v-if="p.overrides.fileRewrites" class="mt-2">
                  <RewriteRulesEditor v-model="p.rules" />
                </div>
              </div>

              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.overlayFiles" type="checkbox" class="h-4 w-4" />
                  オーバーレイファイルを追加・削除
                </label>
                <div v-if="p.overrides.overlayFiles" class="mt-2 space-y-2">
                  <p class="text-xs text-gray-500">
                    既定のオーバーレイファイルは残したまま、ファイルを追加します(既定と同じパスは内容を上書き)。既定のファイルを配置したくない場合は「配置しない」にチェックします。
                  </p>
                  <div v-if="overlayDeleteCandidates(p).length > 0">
                    <p class="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                      既定のファイル
                    </p>
                    <label
                      v-for="path in overlayDeleteCandidates(p)"
                      :key="path"
                      class="flex items-center gap-2 py-0.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        class="h-3.5 w-3.5"
                        :checked="p.deletePaths.includes(path)"
                        @change="toggleOverlayDelete(p, path, $event)"
                      />
                      <code>{{ path }}</code>
                      <span class="text-gray-400">配置しない</span>
                    </label>
                  </div>
                  <div>
                    <p class="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                      追加/上書きするファイル
                    </p>
                    <OverlayFilesEditor v-model="p.overlays" />
                  </div>
                </div>
              </div>

              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.resetVolumes" type="checkbox" class="h-4 w-4" />
                  ボリューム初期化を上書き
                </label>
                <label v-if="p.overrides.resetVolumes" class="mt-2 flex items-start gap-2">
                  <input v-model="p.resetVolumes" type="checkbox" class="mt-0.5 h-4 w-4" />
                  <span>起動のたびにDockerボリュームを初期化する</span>
                </label>
              </div>

              <div>
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="p.overrides.buildMode" type="checkbox" class="h-4 w-4" />
                  ビルドモードを上書き
                </label>
                <select
                  v-if="p.overrides.buildMode"
                  v-model="p.buildMode"
                  :class="[inputClass, 'mt-2']"
                >
                  <option value="auto">auto: オンラインなら外部、なければローカル</option>
                  <option value="remote">remote: 常に外部ビルドサーバー</option>
                  <option value="local">local: 常にローカル</option>
                </select>
              </div>
            </div>
          </div>
        </div>

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
