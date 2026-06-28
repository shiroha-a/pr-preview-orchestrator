<script setup lang="ts">
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

import type { BadgeTone, CommentDTO } from "../types";
import BaseBadge from "./ui/BaseBadge.vue";

defineProps<{ comments: CommentDTO[] }>();

const REVIEW_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  APPROVED: { label: "承認", tone: "green" },
  CHANGES_REQUESTED: { label: "変更要求", tone: "red" },
  COMMENTED: { label: "コメント", tone: "gray" },
  DISMISSED: { label: "却下", tone: "gray" },
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNow(date, { addSuffix: true, locale: ja });
}

function reviewMeta(c: CommentDTO) {
  return c.kind === "review" && c.state ? (REVIEW_STATE[c.state] ?? null) : null;
}
</script>

<template>
  <p v-if="comments.length === 0" class="text-sm text-gray-500">コメントはありません。</p>
  <ul v-else class="space-y-3">
    <li
      v-for="c in comments"
      :key="c.id"
      class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
    >
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800"
      >
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <img v-if="c.authorAvatar" :src="c.authorAvatar" alt="" class="h-5 w-5 rounded-full" />
          <span class="font-medium">{{ c.author }}</span>
          <BaseBadge v-if="reviewMeta(c)" :tone="reviewMeta(c)!.tone">
            {{ reviewMeta(c)!.label }}
          </BaseBadge>
          <code
            v-if="c.kind === 'review-comment' && c.path"
            class="rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            {{ c.path }}{{ c.line ? `:${c.line}` : "" }}
          </code>
        </div>
        <time class="text-xs text-gray-400">{{ relativeTime(c.createdAt) }}</time>
      </div>
      <div
        v-if="c.body"
        class="px-3 py-2 text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200"
      >
        {{ c.body }}
      </div>
    </li>
  </ul>
</template>
