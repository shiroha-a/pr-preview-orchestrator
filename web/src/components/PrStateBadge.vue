<script setup lang="ts">
import { computed } from "vue";

import type { BadgeTone } from "../types";
import BaseBadge from "./ui/BaseBadge.vue";

const props = defineProps<{ state: string }>();

const meta = computed<{ label: string; tone: BadgeTone }>(() => {
  if (props.state === "merged") return { label: "マージ済み", tone: "purple" };
  if (props.state === "closed") return { label: "クローズ", tone: "red" };
  return { label: "オープン", tone: "green" };
});
</script>

<template>
  <BaseBadge :tone="meta.tone">{{ meta.label }}</BaseBadge>
</template>
