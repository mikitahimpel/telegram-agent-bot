<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import { fmtDuration } from "../model/describe-status.ts"
import type { ChunkState, ChunkVm } from "../model/types.ts"

const props = defineProps<{ chunks: ChunkVm[] }>()
const { t, now } = useApp()
const selected = ref<number | null>(null)
const states: ChunkState[] = ["confirmed", "sent", "waiting", "failed", "conflict", "corrupt", "lost"]
const chosen = computed(() => props.chunks.find((c) => c.seq === selected.value) ?? null)
const present = computed(() => states.filter((s) => props.chunks.some((c) => c.state === s)))
</script>

<template>
  <div>
    <div class="grid" role="list" data-testid="chunk-grid">
      <button
        v-for="c in chunks"
        :key="c.seq"
        class="cell"
        :class="[`cell-${c.state}`, { selected: selected === c.seq }]"
        role="listitem"
        type="button"
        :aria-label="`${t('trip.chunk.title', { n: c.seq + 1 })}: ${t(`trip.legend.${c.state}`)}`"
        @click="selected = selected === c.seq ? null : c.seq"
      >
        {{ c.seq + 1 }}
      </button>
    </div>
    <ul class="legend">
      <li v-for="s in states" :key="s" :class="{ dim: !present.includes(s) }">
        <span class="swatch" :class="`cell-${s}`" />{{ t(`trip.legend.${s}`) }}
      </li>
    </ul>
    <div v-if="chosen" class="card chunk-info" data-testid="chunk-info">
      <strong>{{ t("trip.chunk.title", { n: chosen.seq + 1 }) }}</strong> ·
      {{ t("trip.chunk.rows", { n: chosen.rows }) }}
      <p>{{ t(`trip.chunk.reason.${chosen.state}`) }}</p>
      <p class="muted">
        {{ t("trip.chunk.attempts", { n: chosen.attempts }) }}
        <template v-if="chosen.nextRetryAt">
          · {{ t("trip.chunk.next", { next: fmtDuration(t, chosen.nextRetryAt - now) }) }}</template
        >
        <template v-if="chosen.lastError"> · {{ chosen.lastError }}</template>
      </p>
    </div>
  </div>
</template>
