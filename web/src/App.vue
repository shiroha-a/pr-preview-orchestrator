<script setup lang="ts">
import AppHeader from "./components/AppHeader.vue";
</script>

<template>
  <div
    class="flex min-h-full flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100"
  >
    <AppHeader />
    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <RouterView :key="$route.fullPath" />
    </main>
  </div>
</template>
