<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import StatusCard from "../components/StatusCard.vue"
import { fmtNumber } from "../i18n/format.ts"
import { describeStatus, fmtDuration } from "../model/describe-status.ts"
import type { SensorKey } from "../model/types.ts"

const { backend, t, lang, now } = useApp()
const rec = computed(() => backend.rec.value)
const recView = computed(() => describeStatus({ kind: "recorder", state: rec.value }, lang.value, now.value))
const connView = computed(() => (backend.conn.value._tag === "Lost" || backend.conn.value._tag === "Failed" ? describeStatus({ kind: "connection", state: backend.conn.value }, lang.value, now.value) : null))

const sensors: { key: SensorKey; label: "speed" | "rpm" | "coolant" | "fuel" | "voltage"; digits: number }[] = [
  { key: "speedKmh", label: "speed", digits: 0 },
  { key: "rpm", label: "rpm", digits: 0 },
  { key: "coolantC", label: "coolant", digits: 0 },
  { key: "fuelRateLph", label: "fuel", digits: 1 },
  { key: "voltageV", label: "voltage", digits: 1 }
]
const unsupported = (k: SensorKey) => backend.supported.value !== null && !backend.supported.value.includes(k)
const value = (k: SensorKey, digits: number): string => {
  const v = backend.reading.value[k]
  return v === null ? "—" : fmtNumber(lang.value, Number(v.toFixed(digits)))
}
const quality = computed<"good" | "weak" | "lost" | "idle">(() => {
  const c = backend.conn.value
  const r = rec.value
  if (c._tag === "Lost" || c._tag === "Failed") return "lost"
  if (r._tag !== "Recording") return "idle"
  if (r.gapOpen || now.value - r.lastSampleAt > 5000) return "weak"
  return "good"
})
const lastAgo = computed(() => (rec.value._tag === "Recording" ? fmtDuration(t.value, now.value - rec.value.lastSampleAt) : null))
const estimate = computed(() => backend.fuelSource.value === "maf_estimate")
</script>

<template>
  <div class="screen">
    <StatusCard v-if="connView" :view="connView" />
    <StatusCard :view="recView" big />

    <div class="gauges" data-testid="gauges">
      <div v-for="s in sensors" :key="s.key" class="gauge" :class="{ off: unsupported(s.key) }" :data-sensor="s.key">
        <span class="gauge-label">{{ t(`recording.sensor.${s.label}`) }}</span>
        <template v-if="unsupported(s.key)">
          <b class="gauge-na">{{ t("recording.unsupported") }}</b>
          <small>{{ t("recording.unsupported.hint") }}</small>
        </template>
        <template v-else>
          <b class="gauge-value">
            <template v-if="s.key === 'fuelRateLph' && estimate && backend.reading.value.fuelRateLph !== null">≈ </template>{{ value(s.key, s.digits) }}
            <small>{{ t(`recording.unit.${s.label}`) }}</small>
          </b>
          <small v-if="s.key === 'fuelRateLph' && estimate" :title="t('recording.fuel.estimate')">{{ t("estimate") }}. {{ t("recording.fuel.estimate") }}</small>
        </template>
      </div>
    </div>

    <div class="card facts" data-testid="facts">
      <div><span>{{ t("recording.quality") }}</span><b :class="`q-${quality}`">{{ t(`recording.quality.${quality}`) }}</b></div>
      <div v-if="rec._tag === 'Recording'" data-testid="distance"><span>{{ t("recording.distance") }}</span><b>{{ t("trips.distance", { km: fmtNumber(lang, rec.distanceKm, 1) }) }}</b></div>
      <div v-if="rec._tag === 'Recording'"><span>{{ t("recording.points") }}</span><b>{{ fmtNumber(lang, rec.points) }}</b></div>
      <div v-if="rec._tag === 'Recording'"><span>{{ t("recording.chunks") }}</span><b>{{ rec.chunks }}</b></div>
      <div v-if="lastAgo"><span>{{ t("recording.lastSample", { ago: lastAgo }) }}</span></div>
      <div data-testid="wakelock"><span>{{ backend.wakeLock.value ? t("recording.wakelock.on") : t("recording.wakelock.off") }}</span></div>
    </div>
    <p class="muted">{{ t("recording.lock.hint") }}</p>
  </div>
</template>
