<script setup lang="ts">
import { ref } from "vue";
import { RefreshCw } from "lucide-vue-next";

import BaseButton from "./ui/BaseButton.vue";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const props = withDefaults(
  defineProps<{ action: () => Promise<unknown>; label: string; variant?: Variant }>(),
  { variant: "secondary" },
);

const emit = defineEmits<{ done: [] }>();

const pending = ref(false);
const error = ref<string | null>(null);

async function run() {
  pending.value = true;
  error.value = null;
  try {
    await props.action();
    emit("done");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "処理に失敗しました";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-end gap-1">
    <BaseButton :variant="variant" size="sm" :disabled="pending" @click="run">
      <RefreshCw :class="['h-4 w-4', pending && 'animate-spin']" />
      {{ label }}
    </BaseButton>
    <p v-if="error" class="max-w-xs text-right text-xs text-red-600">{{ error }}</p>
  </div>
</template>
