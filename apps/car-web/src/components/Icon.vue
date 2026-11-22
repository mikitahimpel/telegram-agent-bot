<script setup lang="ts">
import { computed } from "vue"

export type IconName =
  | "gauge"
  | "route"
  | "record"
  | "settings"
  | "engine"
  | "battery"
  | "fuel"
  | "stats"
  | "chevron-right"
  | "chevron-left"
  | "check"
  | "alert"
  | "stop"
  | "info"
  | "bluetooth"
  | "cable"
  | "wave"
  | "close"
  | "spinner"

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

type Shape = { strokes: string[]; fills?: string[] }

const SHAPES: Record<IconName, Shape> = {
  gauge: {
    strokes: ["M4.2 17.6a8.6 8.6 0 1 1 15.6 0", "M12 14l3.6-4.4", "M7 10.4l.9.6M12 6.8v1.1M17 10.4l-.9.6"],
    fills: [circle(12, 14, 1.7)]
  },
  route: {
    strokes: [circle(5.5, 18, 2), "M7.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7.5", circle(18.5, 6, 2)]
  },
  record: { strokes: [circle(12, 12, 8.5)], fills: [circle(12, 12, 3.6)] },
  settings: { strokes: ["M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9", circle(15, 7.5, 2), circle(9, 16.5, 2)] },
  engine: {
    strokes: [
      "M9 5.5h5M11.5 5.5v2.5",
      "M6.5 8h9l2 2.5h2v4h-2L15.5 17h-7l-2-2.5z",
      "M3.5 10.5v5.5M3.5 13.2h3",
      "M11 10.5l-1.5 2.5h3L11 15.5"
    ]
  },
  battery: {
    strokes: [
      "M5.5 8h13A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-8A1.5 1.5 0 0 1 5.5 8z",
      "M7.5 8V5.8M16.5 8V5.8",
      "M7 13.5h3M14.5 13.5h3M16 12v3"
    ]
  },
  fuel: {
    strokes: [
      "M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14",
      "M3.5 20h12",
      "M5 10h9",
      "M14 8.5l3 3v5.3a1.5 1.5 0 0 0 3 0V8.2L17.6 5.8"
    ]
  },
  stats: { strokes: ["M4 20h16", "M6.5 16v-4M11 16V6.5M15.5 16v-6M20 16v-2.5"] },
  "chevron-right": { strokes: ["M9.5 5.5L16 12l-6.5 6.5"] },
  "chevron-left": { strokes: ["M14.5 5.5L8 12l6.5 6.5"] },
  check: { strokes: ["M5 12.5l4.5 4.5L19 7.5"] },
  alert: {
    strokes: [
      "M10.3 4.6a2 2 0 0 1 3.4 0l7.2 12.6a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3z",
      "M12 9.5v4.2",
      "M12 16.8v.1"
    ]
  },
  stop: { strokes: ["M8.4 3.5h7.2l4.9 4.9v7.2l-4.9 4.9H8.4l-4.9-4.9V8.4z", "M9.5 9.5l5 5M14.5 9.5l-5 5"] },
  info: { strokes: [circle(12, 12, 8.5), "M12 11v5.2", "M12 7.8v.1"] },
  bluetooth: { strokes: ["M6.5 7.5l10 9L12 20.5v-17l4.5 4-10 9"] },
  cable: { strokes: ["M9 3.5v4M15 3.5v4", "M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0z", "M12 16.5v4"] },
  wave: { strokes: ["M3 12h3.5l2.2-5.5 4.6 11 3-7.5 1.7 2H21"] },
  close: { strokes: ["M6.5 6.5l11 11M17.5 6.5l-11 11"] },
  spinner: { strokes: ["M12 3.5a8.5 8.5 0 1 1-8.5 8.5"] }
}

const props = defineProps<{ name: IconName; size?: number }>()
const shape = computed(() => SHAPES[props.name])
</script>

<template>
  <svg
    class="icon"
    :class="`icon-${name}`"
    :width="size ?? 24"
    :height="size ?? 24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in shape.strokes" :key="d" :d="d" />
    <path v-for="d in shape.fills ?? []" :key="`f${d}`" :d="d" fill="currentColor" stroke="none" />
  </svg>
</template>
