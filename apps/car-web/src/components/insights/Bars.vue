<script setup lang="ts">
import { computed } from "vue"

export type BarItem = { key: string; label: string; value: number | null; caption: string }

const props = defineProps<{ items: ReadonlyArray<BarItem>; selected: string | null; format: (n: number) => string; label: string }>()
const emit = defineEmits<{ select: [key: string] }>()
const max = computed(() => Math.max(1e-6, ...props.items.map((i) => i.value ?? 0)))
</script>

<template>
  <div class="bars" role="group" :aria-label="label" data-testid="bars">
    <button
      v-for="i in items"
      :key="i.key"
      class="bar"
      type="button"
      :class="{ on: selected === i.key, none: i.value === null }"
      :aria-pressed="selected === i.key"
      :aria-label="`${i.caption}: ${i.value === null ? '—' : format(i.value)}`"
      @click="emit('select', i.key)"
    >
      <span class="bar-val">{{ i.value === null ? "—" : format(i.value) }}</span>
      <span class="bar-track"><span class="bar-fill" :style="{ height: `${((i.value ?? 0) / max) * 100}%` }" /></span>
      <span class="bar-label">{{ i.label }}</span>
    </button>
  </div>
</template>
