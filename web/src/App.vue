<script setup lang="ts">
import { Github } from "lucide-vue-next";

import AppHeader from "./components/AppHeader.vue";

const REPO_URL = "https://github.com/shiroha-a/pr-preview-orchestrator";
const LICENSE_URL = "https://github.com/shiroha-a/pr-preview-orchestrator/blob/main/LICENSE";
</script>

<template>
  <div
    class="flex min-h-full flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100"
  >
    <AppHeader />
    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <RouterView :key="$route.fullPath" />
    </main>
    <footer class="border-t border-gray-200 py-4 dark:border-gray-800">
      <div
        class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 text-xs text-gray-500 dark:text-gray-400"
      >
        <span>© 2026 shiroha-a</span>
        <span aria-hidden="true">·</span>
        <a
          :href="LICENSE_URL"
          target="_blank"
          rel="noreferrer"
          class="transition-colors hover:text-gray-900 hover:underline dark:hover:text-gray-100"
        >
          MIT License
        </a>
        <a
          :href="REPO_URL"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub リポジトリ"
          title="GitHub"
          class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <Github class="h-4 w-4" />
        </a>
      </div>
    </footer>
  </div>
</template>
