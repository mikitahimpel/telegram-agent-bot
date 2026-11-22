<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import AsyncState from "../components/insights/AsyncState.vue"
import DemoChip from "../components/insights/DemoChip.vue"
import HeroGauge from "../components/insights/HeroGauge.vue"
import TimeChart, { type ChartBand } from "../components/insights/TimeChart.vue"
import { useFmt } from "../composables/use-fmt.ts"
import { useLoad } from "../composables/use-load.ts"
import { fmtDateTime } from "../i18n/format.ts"
import { batteryTone } from "../model/insights.ts"

const { backend, lang, t } = useApp()
const f = useFmt()
const load = useLoad(
  () => backend.overview(lang.value),
  () => `${lang.value}:${backend.insightsDemo.value}`
)
const o = computed(() => load.data.value)
const hover = ref<number | null>(null)

const RESTING: ChartBand[] = [
  { from: 11.6, to: 12.0, tone: "weak" },
  { from: 12.0, to: 12.4, tone: "watch" },
  { from: 12.4, to: 13.0, tone: "good" }
]
const CRANK: ChartBand[] = [
  { from: 8.5, to: 9.6, tone: "weak" },
  { from: 9.6, to: 10.0, tone: "watch" },
  { from: 10.0, to: 11.5, tone: "good" }
]
const trend = computed(() => o.value?.battery.trend ?? [])
const ts = computed(() => trend.value.map((p) => p.at))
const domain = computed<readonly [number, number]>(() =>
  ts.value.length > 1 ? [ts.value[0]!, ts.value[ts.value.length - 1]!] : [Date.now() - 86_400_000, Date.now()]
)
const fmtDay = (n: number) =>
  new Intl.DateTimeFormat(lang.value === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" }).format(
    new Date(n)
  )
const v1 = (n: number) => f.volts(n)
const v0 = (n: number) => String(Math.round(n * 10) / 10)
</script>

<template>
  <div class="screen battery" data-testid="battery-screen">
    <DemoChip />
    <AsyncState :loading="load.loading.value" :error="load.error.value" :has-data="!!o" @retry="load.reload">
      <template v-if="o">
        <section class="hero" :class="`tone-${batteryTone(o.battery.status)}`" data-testid="battery-status">
          <div class="hero-copy">
            <h2 class="hero-title">{{ t(`battery.status.${o.battery.status}`) }}</h2>
          </div>
          <HeroGauge :tone="batteryTone(o.battery.status)" />
          <p class="hero-text">{{ t(`battery.status.${o.battery.status}.text`) }}</p>
        </section>
        <div class="pair">
          <div class="stat">
            <span class="stat-label">{{ t("battery.resting") }}</span>
            <b class="stat-value" data-testid="resting-v">{{ f.volts(o.battery.lastRestingV) }}</b>
            <small>{{ t("battery.resting.hint") }}</small>
          </div>
          <div class="stat">
            <span class="stat-label">{{ t("battery.crank") }}</span>
            <b class="stat-value" data-testid="crank-v">{{ f.volts(o.battery.lastCrankMinV) }}</b>
            <small>{{ t("battery.crank.hint") }}</small>
          </div>
        </div>
        <div v-if="trend.length > 1" class="card charts">
          <TimeChart
            testid="chart-bat-rest"
            :label="t('battery.chart.resting')"
            :ts="ts"
            :values="trend.map((p) => p.restingV)"
            :domain="domain"
            :bands="RESTING"
            :hover="hover"
            :format="v1"
            :axis-format="v0"
            :x-format="fmtDay"
            dots
            @hover="hover = $event"
          />
          <TimeChart
            testid="chart-bat-crank"
            :label="t('battery.chart.crank')"
            :ts="ts"
            :values="trend.map((p) => p.crankMinV)"
            :domain="domain"
            :bands="CRANK"
            :hover="hover"
            :format="v1"
            :axis-format="v0"
            :x-format="fmtDay"
            dots
            @hover="hover = $event"
          />
          <ul class="legend">
            <li><i class="swatch band-good" />{{ t("battery.legend.good") }}</li>
            <li><i class="swatch band-watch" />{{ t("battery.legend.watch") }}</li>
            <li><i class="swatch band-weak" />{{ t("battery.legend.weak") }}</li>
          </ul>
        </div>
        <p v-else class="card" data-testid="battery-empty">{{ t("battery.empty") }}</p>
        <section class="card explain">
          <h3>{{ t("battery.explain.title") }}</h3>
          <p>{{ t("battery.explain.resting") }}</p>
          <p>{{ t("battery.explain.crank") }}</p>
          <p>{{ t("battery.explain.cold") }}</p>
          <p class="muted">
            {{
              t("battery.explain.estimate", { at: trend.length ? fmtDateTime(lang, trend[trend.length - 1]!.at) : "—" })
            }}
          </p>
        </section>
      </template>
    </AsyncState>
  </div>
</template>
