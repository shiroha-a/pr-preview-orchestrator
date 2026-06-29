<script setup lang="ts">
import { computed } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";

const props = defineProps<{ diff: string }>();

const rendered = computed(() => {
  if (!props.diff.trim()) return "";
  return renderDiffHtml(props.diff, {
    drawFileList: true,
    matching: "lines",
    outputFormat: "line-by-line",
  });
});
</script>

<template>
  <p v-if="!rendered" class="text-sm text-gray-500">差分がありません。</p>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else class="diff-view d2h-auto-color-scheme overflow-x-auto text-sm" v-html="rendered" />
</template>
