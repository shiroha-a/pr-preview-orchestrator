<script setup lang="ts">
import { Boxes, LayoutDashboard, Settings } from "lucide-vue-next";
</script>

<template>
  <header class="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
    <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
      <RouterLink to="/" class="flex items-center gap-2 font-semibold">
        <Boxes class="h-5 w-5 text-blue-600" />
        <span>PR Preview Orchestrator</span>
      </RouterLink>
      <nav class="flex items-center gap-1 text-sm">
        <RouterLink
          to="/"
          title="ダッシュボード"
          aria-label="ダッシュボード"
          class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <LayoutDashboard class="h-4 w-4" />
          <!-- モバイルではラベルを隠しアイコンのみ表示 -->
          <span class="hidden sm:inline">ダッシュボード</span>
        </RouterLink>
        <RouterLink
          to="/settings"
          title="設定"
          aria-label="設定"
          class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Settings class="h-4 w-4" />
          <span class="hidden sm:inline">設定</span>
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
