<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import { fmtDuration } from "../model/describe-status.ts"
import { fmtTime } from "../i18n/format.ts"
import type { GapVm } from "../model/types.ts"

const props = defineProps<{ gaps: GapVm[]; startedAt: number; endedAt: number | null }>()
const { t, lang, now } = useApp()
const end = computed(() => props.endedAt ?? now.value)
const span = computed(() => Math.max(1, end.value - props.startedAt))
const pos = (g: GapVm) => ({
  left: `${Math.max(0, ((g.from - props.startedAt) / span.value) * 100)}%`,
  width: `${Math.max(1.5, ((g.to - g.from) / span.value) * 100)}%`
})
</script>

<template>
  <div data-testid="gaps">
    <p v-if="gaps.length === 0" class="muted">{{ t("trip.gaps.none") }}</p>
    <template v-else>
      <div class="timeline" aria-hidden="true">
        <span v-for="(g, i) in gaps" :key="i" class="gap-mark" :style="pos(g)" />
      </div>
      <ul class="gap-list">
        <li v-for="(g, i) in gaps" :key="i">
          <strong>{{ fmtTime(lang, g.from) }}–{{ fmtTime(lang, g.to) }}</strong> · {{ t(`trip.gap.${g.reason}`) }}
          <span class="muted"> · {{ t("trip.gap.length", { t: fmtDuration(t, g.to - g.from) }) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
