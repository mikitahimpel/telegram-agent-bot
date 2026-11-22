<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../../app-context.ts"

const props = defineProps<{
  ts: ReadonlyArray<number>
  lat: ReadonlyArray<number | null>
  lon: ReadonlyArray<number | null>
  gaps: ReadonlyArray<{ from: number; to: number }>
  hover: number | null
}>()
const { t } = useApp()
const W = 328
const H = 200
const PAD = 16

type Pt = { x: number; y: number; t: number }
const geo = computed(() => {
  const pts: { t: number; la: number; lo: number }[] = []
  props.ts.forEach((time, i) => {
    const la = props.lat[i]
    const lo = props.lon[i]
    if (la != null && lo != null) pts.push({ t: time, la, lo })
  })
  if (pts.length < 2) return null
  const midLat = pts.reduce((s, p) => s + p.la, 0) / pts.length
  const k = Math.cos((midLat * Math.PI) / 180)
  const xs = pts.map((p) => p.lo * k)
  const ys = pts.map((p) => -p.la)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const spanX = Math.max(1e-9, Math.max(...xs) - minX)
  const spanY = Math.max(1e-9, Math.max(...ys) - minY)
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY)
  const offX = (W - spanX * scale) / 2
  const offY = (H - spanY * scale) / 2
  const out: Pt[] = pts.map((p, i) => ({
    t: p.t,
    x: offX + (xs[i]! - minX) * scale,
    y: offY + (ys[i]! - minY) * scale
  }))
  const paths: Pt[][] = []
  let cur: Pt[] = []
  out.forEach((p, i) => {
    const prev = out[i - 1]
    if (prev && props.gaps.some((g) => g.from < p.t && g.to > prev.t)) {
      paths.push(cur)
      cur = []
    }
    cur.push(p)
  })
  paths.push(cur)
  return { out, paths: paths.filter((p) => p.length > 1) }
})
const d = (p: Pt[]) => p.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join("")
const marker = computed(() => {
  const g = geo.value
  if (!g || props.hover === null) return null
  let best = g.out[0]!
  for (const p of g.out) if (Math.abs(p.t - props.hover) < Math.abs(best.t - props.hover)) best = p
  return best
})
</script>

<template>
  <figure v-if="geo" class="route" data-testid="route">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="t('trip.route')" class="route-svg">
      <defs>
        <pattern id="route-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" class="route-grid-line" />
        </pattern>
      </defs>
      <rect :width="W" :height="H" fill="url(#route-grid)" />
      <path v-for="(p, i) in geo.paths" :key="`g${i}`" :d="d(p)" class="route-glow" />
      <path v-for="(p, i) in geo.paths" :key="i" :d="d(p)" class="route-line" />
      <circle :cx="geo.out[0]!.x" :cy="geo.out[0]!.y" r="6" class="route-start" />
      <circle :cx="geo.out[geo.out.length - 1]!.x" :cy="geo.out[geo.out.length - 1]!.y" r="6" class="route-end" />
      <circle v-if="marker" :cx="marker.x" :cy="marker.y" r="7" class="route-now" />
    </svg>
    <figcaption class="route-legend">
      <span><i class="dot-start" />{{ t("trip.route.start") }}</span>
      <span><i class="dot-end" />{{ t("trip.route.end") }}</span>
      <span v-if="gaps.length">{{ t("trip.route.gaps") }}</span>
    </figcaption>
  </figure>
  <p v-else class="muted" data-testid="route-empty">{{ t("trip.route.none") }}</p>
</template>
