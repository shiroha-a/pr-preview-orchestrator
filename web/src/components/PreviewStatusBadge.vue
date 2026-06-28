<script setup lang="ts">
import { computed } from "vue";

import type { BadgeTone } from "../types";
import BaseBadge from "./ui/BaseBadge.vue";

const props = defineProps<{ status: string }>();

const META: Record<string, { label: string; tone: BadgeTone }> = {
  idle: { label: "未作成", tone: "gray" },
  pending: { label: "待機中", tone: "amber" },
  cloning: { label: "クローン中", tone: "amber" },
  building: { label: "ビルド中", tone: "amber" },
  running: { label: "稼働中", tone: "green" },
  stopping: { label: "停止処理中", tone: "amber" },
  stopped: { label: "停止済み", tone: "gray" },
  failed: { label: "失敗", tone: "red" },
};

const meta = computed(
  () => META[props.status] ?? { label: props.status, tone: "gray" as BadgeTone },
);
</script>

<template>
  <BaseBadge :tone="meta.tone">{{ meta.label }}</BaseBadge>
</template>
