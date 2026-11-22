<script setup lang="ts">
import { computed } from "vue"

export type GaugeTone = "ok" | "nodata" | "info" | "watch" | "soon" | "urgent" | "muted"

const props = defineProps<{ tone: GaugeTone }>()

const LEVEL: Record<GaugeTone, number> = { ok: 1, info: 0.9, watch: 0.64, soon: 0.38, urgent: 0.16, nodata: 0, muted: 0 }
const GLYPH: Record<GaugeTone, string> = { ok: "", info: "i", watch: "!", soon: "!", urgent: "!!", nodata: "–", muted: "–" }

const C = 60
const R = 46
const START = 135
const SWEEP = 270
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}
const a = polar(START, R)
const b = polar(START + SWEEP, R)
const ARC = `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${R} ${R} 0 1 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
const TICKS = Array.from({ length: 31 }, (_, i) => {
  const deg = START + (SWEEP * i) / 30
  const major = i % 5 === 0
  const p = polar(deg, major ? 31 : 33)
  const q = polar(deg, 36)
  return { d: `M${p.x.toFixed(2)} ${p.y.toFixed(2)}L${q.x.toFixed(2)} ${q.y.toFixed(2)}`, major }
})
const offset = computed(() => 100 * (1 - LEVEL[props.tone]))
const glyph = computed(() => GLYPH[props.tone])
const empty = computed(() => LEVEL[props.tone] === 0)
</script>

<template>
  <svg class="hero-gauge" :class="`gauge-${tone}`" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <path :d="ARC" class="hg-track" />
    <path v-for="tk in TICKS" :key="tk.d" :d="tk.d" class="hg-tick" :class="{ major: tk.major }" />
    <path
      v-if="!empty"
      :d="ARC"
      class="hg-value"
      pathLength="100"
      stroke-dasharray="100"
      :style="{ strokeDashoffset: offset }"
    />
    <path v-if="tone === 'ok'" d="M47 61l9 9 18-19" class="hg-check" />
    <text v-else x="60" y="61" class="hg-glyph" text-anchor="middle" dominant-baseline="central">{{ glyph }}</text>
  </svg>
</template>
