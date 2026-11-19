<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import ChunkGrid from "../components/ChunkGrid.vue"
import GapTimeline from "../components/GapTimeline.vue"
import StatusCard from "../components/StatusCard.vue"
import AsyncState from "../components/insights/AsyncState.vue"
import DemoChip from "../components/insights/DemoChip.vue"
import RouteMap from "../components/insights/RouteMap.vue"
import TimeChart from "../components/insights/TimeChart.vue"
import { useFmt } from "../composables/use-fmt.ts"
import { useLoad } from "../composables/use-load.ts"
import { fmtDateTime, fmtNumber, fmtTime } from "../i18n/format.ts"
import { describeStatus } from "../model/describe-status.ts"
import { canDeleteLocal, tripCounters } from "../model/trips.ts"

const props = defineProps<{ tripId: string }>()
const { backend, t, lang, now, back } = useApp()
const f = useFmt()

const trip = computed(() => backend.trips.value.find((x) => x.tripId === props.tripId) ?? null)
const key = () => `${props.tripId}:${lang.value}:${backend.insightsDemo.value}`
const insight = useLoad(() => backend.tripInsight(props.tripId, lang.value), key)
const series = useLoad(() => backend.tripSeries(props.tripId), key)
const i = computed(() => insight.data.value)
const s = computed(() => series.data.value)

const hover = ref<number | null>(null)
const domain = computed<readonly [number, number]>(() => {
  const ins = i.value
  const ser = s.value
  if (ins) return [ins.startedAt, ins.endedAt]
  if (ser && ser.ts.length > 1) return [ser.ts[0]!, ser.ts[ser.ts.length - 1]!]
  return [0, 1]
})
const col = (name: string) => s.value?.columns[name] ?? []
const hasFuelSeries = computed(() => col("fuel_rate_lph").some((v) => v !== null))
const gapMinutes = computed(() => Math.round((s.value?.gaps ?? []).reduce((sum, g) => sum + (g.to - g.from), 0) / 60_000))
const partial = computed(() => !!i.value && (!i.value.complete || gapMinutes.value > 0))
const clock = (n: number) => fmtTime(lang.value, n)
const int = (n: number) => String(Math.round(n))
const one = (n: number) => fmtNumber(lang.value, n, 1)

type ChartDef = { id: string; column: string; label: string; format: (n: number) => string; axis: (n: number) => string; zero: boolean; show: boolean; missing?: string }
const charts = computed<ChartDef[]>(() => [
  { id: "speed", column: "speed_kmh", label: t.value("trip.chart.speed"), format: (n) => f.kmh(n), axis: int, zero: true, show: true },
  { id: "rpm", column: "rpm", label: t.value("trip.chart.rpm"), format: (n) => f.rpm(n), axis: int, zero: true, show: true },
  { id: "coolant", column: "coolant_c", label: t.value("trip.chart.coolant"), format: (n) => f.celsius(n), axis: int, zero: false, show: true },
  { id: "fuel", column: "fuel_rate_lph", label: t.value("trip.chart.fuel"), format: (n) => f.lph(n), axis: one, zero: true, show: hasFuelSeries.value, missing: t.value("trip.chart.fuel.missing") },
  { id: "voltage", column: "voltage_v", label: t.value("trip.chart.voltage"), format: (n) => f.volts(n), axis: one, zero: false, show: true }
])

const totalBandSeconds = computed(() => (i.value?.speedBands ?? []).reduce((sum, b) => sum + b.seconds, 0) || 1)
const maxBandFuel = computed(() => Math.max(1, ...(i.value?.speedBands ?? []).map((b) => b.fuelPer100Km ?? 0)))

const view = computed(() =>
  trip.value ? describeStatus({ kind: "trip", state: trip.value.sync, localCopyLost: !trip.value.localCopy, sync: backend.sync.value }, lang.value, now.value) : null
)
const counters = computed(() => (trip.value ? tripCounters(trip.value) : null))
const confirmDelete = ref(false)
const showExport = ref(false)
const exportable = computed(() => !!trip.value && trip.value.localCopy && trip.value.sync._tag !== "Recording")
const doDelete = async () => {
  confirmDelete.value = false
  await backend.deleteLocal(props.tripId)
  back()
}
const retryAll = async () => {
  await Promise.all([insight.reload(), series.reload()])
}
</script>

<template>
  <div class="screen trip-insights" data-testid="trip-detail">
    <DemoChip />
    <AsyncState :loading="insight.loading.value" :error="insight.error.value" :has-data="!!i" @retry="retryAll">
      <template v-if="i">
        <header class="trip-head">
          <h2 class="trip-title">{{ fmtDateTime(lang, i.startedAt) }}</h2>
          <p class="muted">{{ clock(i.startedAt) }} – {{ clock(i.endedAt) }}</p>
        </header>

        <p v-if="partial" class="notice" role="note" data-testid="partial-note">
          {{ t("trip.partial", { min: gapMinutes }) }}
        </p>

        <section class="numbers" data-testid="trip-numbers">
          <div class="num primary-num">
            <span class="stat-label">{{ t("trip.distance") }}</span>
            <b class="stat-value" data-testid="trip-distance">{{ f.km(i.distanceKm) }}</b>
          </div>
          <div class="num primary-num">
            <span class="stat-label">{{ t("trip.duration") }}</span>
            <b class="stat-value">{{ f.dur(i.durationS) }}</b>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.moving") }}</span>
            <b>{{ f.dur(i.movingS) }}</b>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.idle") }}</span>
            <b>{{ f.dur(i.idleS) }}</b>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.avgSpeed") }}</span>
            <b>{{ f.kmh(i.avgSpeedKmh) }}</b>
            <small>{{ t("trip.avgMoving", { v: f.kmh(i.avgMovingSpeedKmh) }) }}</small>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.maxSpeed") }}</span>
            <b>{{ f.kmh(i.maxSpeedKmh) }}</b>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.fuel") }}<template v-if="i.fuelIsEstimate"> · {{ t("common.estimate") }}</template></span>
            <b data-testid="trip-fuel">{{ i.fuelL === null ? t("trip.fuel.none") : f.l(i.fuelL, 2) }}</b>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.per100") }}<template v-if="i.fuelIsEstimate"> · {{ t("common.estimate") }}</template></span>
            <b>{{ i.fuelPer100Km === null ? t("trip.fuel.none") : f.l100(i.fuelPer100Km) }}</b>
          </div>
          <div class="num">
            <span class="stat-label">{{ t("trip.idleFuel") }}</span>
            <b>{{ i.idleFuelL === null ? t("trip.fuel.none") : f.l(i.idleFuelL, 2) }}</b>
          </div>
        </section>
        <p v-if="i.fuelIsEstimate && i.fuelL !== null" class="muted fine">{{ t("trip.fuel.estimateNote") }}</p>

        <section class="card compare" data-testid="trip-compare">
          <h3>{{ t("trip.compare") }}</h3>
          <p v-if="i.comparedToUsual.fuelPer100KmDeltaPct === null && i.comparedToUsual.avgSpeedDeltaPct === null" class="muted">{{ t("trip.compare.none") }}</p>
          <ul v-else class="plain">
            <li v-if="i.comparedToUsual.fuelPer100KmDeltaPct !== null">
              {{ t("trip.compare.fuel") }}: <b>{{ f.signedPct(i.comparedToUsual.fuelPer100KmDeltaPct) }}</b>
              {{ i.comparedToUsual.fuelPer100KmDeltaPct > 0 ? t("trip.compare.more") : t("trip.compare.less") }}
            </li>
            <li v-if="i.comparedToUsual.avgSpeedDeltaPct !== null">
              {{ t("trip.compare.speed") }}: <b>{{ f.signedPct(i.comparedToUsual.avgSpeedDeltaPct) }}</b>
              {{ i.comparedToUsual.avgSpeedDeltaPct > 0 ? t("trip.compare.faster") : t("trip.compare.slower") }}
            </li>
          </ul>
        </section>

        <section class="card" data-testid="trip-route-card">
          <h3>{{ t("trip.route") }}</h3>
          <RouteMap v-if="s" :ts="s.ts" :lat="col('lat')" :lon="col('lon')" :gaps="s.gaps" :hover="hover" />
        </section>

        <section class="card charts" data-testid="trip-charts">
          <div class="charts-head">
            <h3>{{ t("trip.charts") }}</h3>
            <button v-if="hover !== null" class="link" type="button" data-testid="clear-hover" @click="hover = null">{{ t("trip.charts.clear", { time: clock(hover) }) }}</button>
            <span v-else class="muted fine">{{ t("trip.charts.hint") }}</span>
          </div>
          <AsyncState :loading="series.loading.value" :error="series.error.value" :has-data="!!s" @retry="series.reload">
            <template v-if="s">
              <template v-for="c in charts" :key="c.id">
                <TimeChart
                  v-if="c.show"
                  :testid="`chart-${c.id}`"
                  :label="c.label"
                  :ts="s.ts"
                  :values="col(c.column)"
                  :gaps="s.gaps"
                  :domain="domain"
                  :hover="hover"
                  :format="c.format"
                  :axis-format="c.axis"
                  :x-format="clock"
                  :zero-based="c.zero"
                  @hover="hover = $event"
                />
                <p v-else class="muted chart-missing" :data-testid="`chart-${c.id}-missing`">{{ c.label }}: {{ c.missing }}</p>
              </template>
              <p v-if="s.gaps.length" class="muted fine">{{ t("trip.charts.gaps") }}</p>
            </template>
          </AsyncState>
        </section>

        <section v-if="i.speedBands.length" class="card" data-testid="trip-bands">
          <h3>{{ t("trip.bands") }}</h3>
          <p class="muted">{{ t("trip.bands.hint") }}</p>
          <ul class="bandlist">
            <li v-for="b in i.speedBands" :key="b.fromKmh">
              <span class="band-name">{{ b.fromKmh }}–{{ b.toKmh >= 120 ? "+" : b.toKmh }} {{ t("unit.kmh") }}</span>
              <span class="band-bar"><span class="band-fill" :style="{ width: `${b.fuelPer100Km === null ? 0 : (b.fuelPer100Km / maxBandFuel) * 100}%` }" /></span>
              <b class="band-val">{{ f.l100(b.fuelPer100Km) }}</b>
              <small class="band-time">{{ t("trip.bands.share", { p: fmtNumber(lang, Math.round((b.seconds / totalBandSeconds) * 100)) }) }} · {{ f.dur(b.seconds) }}</small>
            </li>
          </ul>
        </section>

        <section class="card style" data-testid="trip-style">
          <h3>{{ t("trip.style") }}</h3>
          <div class="pair">
            <div class="stat">
              <span class="stat-label">{{ t("trip.hardAcc") }}</span>
              <b class="stat-value" data-testid="hard-acc">{{ i.hardAccelerations }}</b>
            </div>
            <div class="stat">
              <span class="stat-label">{{ t("trip.hardBrake") }}</span>
              <b class="stat-value" data-testid="hard-brake">{{ i.hardBrakings }}</b>
            </div>
          </div>
          <p class="muted">{{ t("trip.style.hint") }}</p>
        </section>

        <section class="card engine-facts">
          <h3>{{ t("trip.engine") }}</h3>
          <dl class="facts-dl">
            <dt>{{ t("trip.maxRpm") }}</dt>
            <dd>{{ f.rpm(i.maxRpm) }}</dd>
            <dt>{{ t("trip.maxCoolant") }}</dt>
            <dd>{{ f.celsius(i.maxCoolantC) }}</dd>
            <dt>{{ t("trip.warmup") }}</dt>
            <dd>{{ i.warmupS === null ? t("trip.warmup.none") : f.dur(i.warmupS) }}</dd>
            <dt>{{ t("trip.minVoltage") }}</dt>
            <dd>{{ f.volts(i.minVoltageV) }}</dd>
          </dl>
        </section>
      </template>
    </AsyncState>

    <details v-if="trip && view && counters" class="card fold" data-testid="transfer">
      <summary>{{ t("trip.transfer") }}</summary>
      <StatusCard :view="view" :trip-id="trip.tripId" />
      <div class="counters" data-testid="counters">
        <div class="counter">
          <b>{{ fmtNumber(lang, counters.recorded) }}</b>
          <span>{{ t("trip.recorded") }}</span>
          <small>{{ t("trip.recorded.hint") }}</small>
        </div>
        <div class="counter">
          <b>{{ counters.sent }}/{{ counters.total }}</b>
          <span>{{ t("trip.sent") }}</span>
          <small>{{ t("trip.parts.hint") }}</small>
        </div>
        <div class="counter">
          <b>{{ counters.confirmed }}/{{ counters.total }}</b>
          <span>{{ t("trip.confirmed") }}</span>
          <small>{{ t("trip.parts.hint") }}</small>
        </div>
      </div>
      <h4>{{ t("trip.chunks") }}</h4>
      <p class="muted">{{ t("trip.chunks.hint") }}</p>
      <ChunkGrid :chunks="trip.chunks" />
      <h4>{{ t("trip.gaps") }}</h4>
      <GapTimeline :gaps="trip.gaps" :started-at="trip.startedAt" :ended-at="trip.endedAt" />
      <div class="actions">
        <button class="btn" type="button" data-testid="export" :disabled="!exportable" @click="showExport = true; backend.exportTrip(trip.tripId)">
          {{ t("trip.export") }}
        </button>
        <pre v-if="showExport" class="steps">{{ t("trip.export.steps") }}</pre>
        <button class="btn btn-danger" type="button" data-testid="delete" :disabled="!canDeleteLocal(trip)" @click="confirmDelete = true">
          {{ t("trip.delete") }}
        </button>
        <p v-if="!canDeleteLocal(trip) && trip.localCopy" class="muted">{{ t("trip.delete.only") }}</p>
        <p v-if="!trip.localCopy" class="muted">{{ t("trip.localGone") }}</p>
      </div>
    </details>

    <div v-if="confirmDelete" class="modal" role="dialog" aria-modal="true" data-testid="delete-dialog">
      <div class="card">
        <p>{{ t("trip.delete.confirm") }}</p>
        <button class="btn btn-danger" type="button" @click="doDelete">{{ t("trip.delete.confirmYes") }}</button>
        <button class="btn" type="button" @click="confirmDelete = false">{{ t("common.cancel") }}</button>
      </div>
    </div>
  </div>
</template>
