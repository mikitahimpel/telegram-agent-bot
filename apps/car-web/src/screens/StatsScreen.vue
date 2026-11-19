<script setup lang="ts">
import type { PeriodStats } from "@bot/car-format/insights"
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import AsyncState from "../components/insights/AsyncState.vue"
import Bars from "../components/insights/Bars.vue"
import DemoChip from "../components/insights/DemoChip.vue"
import { useFmt } from "../composables/use-fmt.ts"
import { useLoad } from "../composables/use-load.ts"
import { periodLabel, periodTitle } from "../model/insights.ts"

type Metric = "distanceKm" | "durationS" | "fuelL" | "fuelPer100Km" | "avgSpeedKmh" | "idleShare"
const METRICS: Metric[] = ["distanceKm", "durationS", "fuelL", "fuelPer100Km", "avgSpeedKmh", "idleShare"]

const { backend, lang, t } = useApp()
const f = useFmt()
const load = useLoad(
  () => backend.overview(lang.value),
  () => `${lang.value}:${backend.insightsDemo.value}`
)
const o = computed(() => load.data.value)
const kind = ref<"week" | "month">("week")
const metric = ref<Metric>("distanceKm")
const picked = ref<string | null>(null)

const rows = computed<ReadonlyArray<PeriodStats>>(
  () => (kind.value === "week" ? o.value?.byWeek : o.value?.byMonth) ?? []
)
const value = (p: PeriodStats, m: Metric): number | null =>
  m === "idleShare" ? (p.idleShare === null ? null : p.idleShare * 100) : p[m]
const fmtMetric = (n: number): string => {
  switch (metric.value) {
    case "distanceKm":
      return f.km(n, 0)
    case "durationS":
      return f.dur(n * 3600)
    case "fuelL":
      return f.l(n, 0)
    case "fuelPer100Km":
      return f.l100(n)
    case "avgSpeedKmh":
      return f.kmh(n)
    case "idleShare":
      return f.pct(n)
  }
}
const barValue = (p: PeriodStats): number | null => {
  const v = value(p, metric.value)
  return v === null ? null : metric.value === "durationS" ? v / 3600 : v
}
const items = computed(() =>
  rows.value.map((p) => ({
    key: p.period,
    label: periodLabel(p.period, kind.value, lang.value),
    value: barValue(p),
    caption: periodTitle(p.period, kind.value, lang.value)
  }))
)
const current = computed(
  () => rows.value.find((p) => p.period === (picked.value ?? rows.value[rows.value.length - 1]?.period)) ?? null
)
const cell = (p: PeriodStats, m: Metric): string => {
  const v = value(p, m)
  if (v === null) return "—"
  switch (m) {
    case "distanceKm":
      return f.km(v, 0)
    case "durationS":
      return f.dur(v)
    case "fuelL":
      return f.l(v, 0)
    case "fuelPer100Km":
      return f.l100(v)
    case "avgSpeedKmh":
      return f.kmh(v)
    case "idleShare":
      return f.pct(v)
  }
}
</script>

<template>
  <div class="screen stats" data-testid="stats-screen">
    <DemoChip />
    <AsyncState :loading="load.loading.value" :error="load.error.value" :has-data="!!o" @retry="load.reload">
      <template v-if="o">
        <div class="seg" role="tablist" :aria-label="t('stats.period')">
          <button
            v-for="k in ['week', 'month'] as const"
            :key="k"
            type="button"
            role="tab"
            :aria-selected="kind === k"
            :class="{ on: kind === k }"
            :data-testid="`period-${k}`"
            @click="
              kind = k;
              picked = null
            "
          >
            {{ t(`stats.${k}`) }}
          </button>
        </div>
        <div class="chips" role="group" :aria-label="t('stats.metric')">
          <button
            v-for="m in METRICS"
            :key="m"
            type="button"
            class="chip"
            :class="{ on: metric === m }"
            :aria-pressed="metric === m"
            :data-testid="`metric-${m}`"
            @click="metric = m"
          >
            {{ t(`stats.metric.${m}`) }}
          </button>
        </div>
        <section v-if="rows.length" class="card">
          <Bars
            :items="items"
            :selected="current?.period ?? null"
            :format="fmtMetric"
            :label="t(`stats.metric.${metric}`)"
            @select="picked = $event"
          />
          <p v-if="current" class="muted bars-caption" data-testid="bars-caption">
            {{ periodTitle(current.period, kind, lang) }}: {{ t(`stats.metric.${metric}`) }} {{ cell(current, metric) }}
          </p>
          <p v-if="metric === 'fuelL' || metric === 'fuelPer100Km'" class="muted fine">
            {{ t("overview.fuel.estimate") }}
          </p>
        </section>
        <p v-else class="card" data-testid="stats-empty">{{ t("stats.empty") }}</p>

        <div v-if="rows.length" class="table-wrap">
          <table class="table" data-testid="stats-table">
            <thead>
              <tr>
                <th scope="col">{{ t("stats.period") }}</th>
                <th v-for="m in METRICS" :key="m" scope="col">{{ t(`stats.metric.${m}`) }}</th>
                <th scope="col">{{ t("stats.trips") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in [...rows].reverse()" :key="p.period">
                <th scope="row">{{ periodTitle(p.period, kind, lang) }}</th>
                <td v-for="m in METRICS" :key="m">{{ cell(p, m) }}</td>
                <td>{{ p.trips }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <section class="card totals" data-testid="stats-totals">
          <h3>{{ t("stats.totals") }}</h3>
          <p>
            {{ f.km(o.totals.distanceKm, 0) }} · {{ f.dur(o.totals.durationS) }} ·
            {{ t("stats.tripsN", { n: o.totals.trips }) }}
          </p>
        </section>
      </template>
    </AsyncState>
  </div>
</template>
