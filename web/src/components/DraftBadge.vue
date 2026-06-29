<script setup lang="ts">
import { FilePen } from "lucide-vue-next";

import BaseBadge from "./ui/BaseBadge.vue";
</script>

<template>
  <BaseBadge tone="gray">
    <FilePen class="h-3 w-3" />
    Draft
  </BaseBadge>
</template>
