<script setup lang="ts">
import { computed } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";

const props = defineProps<{ diff: string }>();

// 追加のみ/削除のみのファイルでは、0側のカウント(+0 / -0)を省略する(issue #43)。
// diff2html に省略オプションが無いため、カウントspanのみを対象に後処理する。
function omitZeroCounts(rawHtml: string): string {
  return rawHtml
    .replace(/<span class="[^"]*d2h-lines-added[^"]*">\+0<\/span>/g, "")
    .replace(/<span class="[^"]*d2h-lines-deleted[^"]*">-0<\/span>/g, "");
}

const rendered = computed(() => {
  if (!props.diff.trim()) return "";
  const raw = renderDiffHtml(props.diff, {
    drawFileList: true,
    matching: "lines",
    outputFormat: "line-by-line",
  });
  return omitZeroCounts(raw);
});
</script>

<template>
  <p v-if="!rendered" class="text-sm text-gray-500">差分がありません。</p>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else class="diff-view d2h-auto-color-scheme overflow-x-auto text-sm" v-html="rendered" />
</template>
