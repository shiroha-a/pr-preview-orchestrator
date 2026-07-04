<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";

const props = defineProps<{ source: string | null | undefined }>();

// GitHub Flavored Markdown。改行を <br> にしてGitHubのコメント挙動に合わせる。
marked.setOptions({ gfm: true, breaks: true });

// リンクは別タブで開き、安全のため rel を付与する(GitHub由来の未信頼コンテンツ対策)。
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const html = computed(() => {
  const src = props.source ?? "";
  if (!src.trim()) return "";
  // PR本文/コメントは未信頼のため、marked出力を必ずDOMPurifyでサニタイズする。
  const raw = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(raw);
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-if="html" class="prose prose-sm dark:prose-invert max-w-none break-words" v-html="html" />
</template>

<style scoped>
/* 幅超過するテーブルはページを押し広げず、テーブル内で横スクロールさせる
   (GitHubのmarkdown CSSと同じ方式)。v-html描画のため :deep で適用する。 */
.prose :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
}
</style>
