<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useApp } from "../../app-context.ts"

export type ChartBand = { from: number; to: number; tone: "good" | "watch" | "weak" }

const props = withDefaults(
  defineProps<{
    label: string
    ts: ReadonlyArray<number>
    values: ReadonlyArray<number | null>
    gaps?: ReadonlyArray<{ from: number; to: number }>
    domain: readonly [number, number]
    hover: number | null
    format: (n: number) => string
    axisFormat: (n: number) => string
    xFormat: (t: number) => string
    bands?: ReadonlyArray<ChartBand>
    dots?: boolean
    area?: boolean
    height?: number
    zeroBased?: boolean
    testid?: string
  }>(),
  { gaps: () => [], bands: () => [], dots: false, area: true, height: 120, zeroBased: false, testid: "chart" }
)
const emit = defineEmits<{ hover: [t: number | null] }>()
const { t } = useApp()

const host = ref<HTMLElement | null>(null)
const width = ref(328)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!host.value || typeof ResizeObserver === "undefined") return
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w && w > 40) width.value = Math.round(w)
  })
  ro.observe(host.value)
})
onBeforeUnmount(() => ro?.disconnect())

const PAD = { top: 20, right: 8, bottom: 22, left: 8 }
const plotW = computed(() => width.value - PAD.left - PAD.right)
const plotH = computed(() => props.height - PAD.top - PAD.bottom)

const t0 = computed(() => props.domain[0])
const t1 = computed(() => props.domain[1])
const x = (time: number) => PAD.left + ((time - t0.value) / Math.max(1, t1.value - t0.value)) * plotW.value

const known = computed(() => props.values.filter((v): v is number => v !== null))
const yRange = computed(() => {
  if (known.value.length === 0) return { lo: 0, hi: 1 }
  let lo = Math.min(...known.value)
  let hi = Math.max(...known.value)
  for (const b of props.bands) {
    lo = Math.min(lo, b.from)
    hi = Math.max(hi, b.to)
  }
  if (props.zeroBased) lo = Math.min(0, lo)
  if (hi - lo < 1e-6) hi = lo + 1
  const pad = (hi - lo) * 0.08
  return { lo: props.zeroBased ? lo : lo - pad, hi: hi + pad }
})
const y = (v: number) => PAD.top + plotH.value - ((v - yRange.value.lo) / (yRange.value.hi - yRange.value.lo)) * plotH.value

const stepMs = computed(() => {
  const d: number[] = []
  for (let i = 1; i < props.ts.length; i++) d.push(props.ts[i]! - props.ts[i - 1]!)
  d.sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)] ?? 4000
})

const crossesGap = (a: number, b: number) => props.gaps.some((g) => g.from < b && g.to > a)

type Segment = { points: { x: number; y: number }[] }
const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  let cur: Segment | null = null
  const limit = props.dots ? Infinity : stepMs.value * 4
  for (let i = 0; i < props.ts.length; i++) {
    const v = props.values[i] ?? null
    const time = props.ts[i]!
    if (v === null) {
      cur = null
      continue
    }
    const prev = props.ts[i - 1]
    const broken = cur === null || prev === undefined || crossesGap(prev, time) || time - prev > limit
    if (broken) {
      cur = { points: [] }
      out.push(cur)
    }
    cur!.points.push({ x: x(time), y: y(v) })
  }
  return out
})

const line = (s: Segment) => s.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("")
const areaPath = (s: Segment) => {
  const base = PAD.top + plotH.value
  const first = s.points[0]!
  const last = s.points[s.points.length - 1]!
  return `${line(s)}L${last.x.toFixed(1)} ${base}L${first.x.toFixed(1)} ${base}Z`
}

const gapRects = computed(() =>
  props.gaps
    .filter((g) => g.to > t0.value && g.from < t1.value)
    .map((g) => {
      const a = x(Math.max(g.from, t0.value))
      const b = x(Math.min(g.to, t1.value))
      return { x: a, w: Math.max(2, b - a) }
    })
)

const gridLines = computed(() => {
  const { lo, hi } = yRange.value
  return [0, 0.5, 1].map((f) => {
    const v = lo + (hi - lo) * f
    return { y: y(v), label: props.axisFormat(v) }
  })
})

const bandRects = computed(() =>
  props.bands.map((b) => ({ y: y(Math.min(b.to, yRange.value.hi)), h: Math.max(0, y(Math.max(b.from, yRange.value.lo)) - y(Math.min(b.to, yRange.value.hi))), tone: b.tone }))
)

const xTicks = computed(() => [0, 0.5, 1].map((f, i) => ({ x: PAD.left + plotW.value * f, label: props.xFormat(t0.value + (t1.value - t0.value) * f), anchor: i === 0 ? "start" : i === 2 ? "end" : "middle" })))

const nearest = (time: number): number | null => {
  const n = props.ts.length
  if (n === 0) return null
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (props.ts[mid]! < time) lo = mid + 1
    else hi = mid
  }
  const a = Math.max(0, lo - 1)
  return Math.abs(props.ts[a]! - time) <= Math.abs(props.ts[lo]! - time) ? a : lo
}

const hoverState = computed(() => {
  if (props.hover === null) return null
  const inGap = props.gaps.some((g) => props.hover! >= g.from && props.hover! <= g.to)
  const idx = nearest(props.hover)
  const v = idx === null || inGap ? null : (props.values[idx] ?? null)
  return { x: x(props.hover), value: v, y: v === null ? null : y(v), inGap }
})

const summary = computed(() => {
  if (known.value.length === 0) return t.value("chart.noData")
  if (hoverState.value) return hoverState.value.value === null ? t.value("chart.noDataHere") : props.format(hoverState.value.value)
  return `${t.value("chart.max")} ${props.format(Math.max(...known.value))}`
})

const timeAt = (clientX: number, el: Element) => {
  const r = el.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (clientX - r.left - PAD.left) / Math.max(1, r.width - PAD.left - PAD.right)))
  return t0.value + f * (t1.value - t0.value)
}
const onMove = (e: PointerEvent) => emit("hover", timeAt(e.clientX, e.currentTarget as Element))
const onLeave = (e: PointerEvent) => {
  if (e.pointerType === "mouse") emit("hover", null)
}
const onKey = (e: KeyboardEvent) => {
  const step = (t1.value - t0.value) / 60
  if (e.key === "ArrowRight") emit("hover", Math.min(t1.value, (props.hover ?? t0.value) + step))
  else if (e.key === "ArrowLeft") emit("hover", Math.max(t0.value, (props.hover ?? t1.value) - step))
  else if (e.key === "Escape") emit("hover", null)
  else return
  e.preventDefault()
}
const aria = computed(() =>
  known.value.length === 0 ? `${props.label}: ${t.value("chart.noData")}` : `${props.label}: ${props.format(Math.min(...known.value))} – ${props.format(Math.max(...known.value))}`
)
</script>

<template>
  <figure class="chart" :data-testid="testid" :data-chart-hover="hover !== null ? 'on' : 'off'">
    <figcaption class="chart-head">
      <span class="chart-label">{{ label }}</span>
      <b class="chart-readout" data-testid="chart-readout">{{ summary }}</b>
    </figcaption>
    <div ref="host" class="chart-host">
      <svg
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="aria"
        tabindex="0"
        class="chart-svg"
        @pointermove="onMove"
        @pointerdown="onMove"
        @pointerleave="onLeave"
        @keydown="onKey"
      >
        <defs>
          <pattern :id="`gap-${testid}`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" class="gap-bg" />
            <line x1="0" y1="0" x2="0" y2="6" class="gap-hatch" />
          </pattern>
        </defs>
        <rect v-for="(b, i) in bandRects" :key="`b${i}`" :x="PAD.left" :y="b.y" :width="plotW" :height="b.h" :class="`band band-${b.tone}`" />
        <g class="grid">
          <template v-for="(g, i) in gridLines" :key="`g${i}`">
            <line :x1="PAD.left" :x2="width - PAD.right" :y1="g.y" :y2="g.y" />
            <text :x="PAD.left + 2" :y="g.y - 3">{{ g.label }}</text>
          </template>
        </g>
        <rect v-for="(g, i) in gapRects" :key="`gap${i}`" :x="g.x" :y="PAD.top" :width="g.w" :height="plotH" :fill="`url(#gap-${testid})`" class="gap-rect" data-testid="chart-gap" />
        <template v-for="(s, i) in segments" :key="`s${i}`">
          <path v-if="area && s.points.length > 1 && !dots" :d="areaPath(s)" class="area" />
          <path v-if="s.points.length > 1" :d="line(s)" class="stroke" />
          <template v-if="s.points.length === 1 || dots">
            <circle v-for="(p, j) in s.points" :key="j" :cx="p.x" :cy="p.y" r="3.5" class="dot" />
          </template>
        </template>
        <g v-if="hoverState" class="cross">
          <line :x1="hoverState.x" :x2="hoverState.x" :y1="PAD.top" :y2="PAD.top + plotH" />
          <circle v-if="hoverState.y !== null" :cx="hoverState.x" :cy="hoverState.y" r="5" />
        </g>
        <g class="xaxis">
          <text v-for="(tk, i) in xTicks" :key="i" :x="tk.x" :y="height - 6" :text-anchor="tk.anchor">{{ tk.label }}</text>
        </g>
      </svg>
    </div>
  </figure>
</template>
