<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import AsyncState from "../components/insights/AsyncState.vue"
import DemoChip from "../components/insights/DemoChip.vue"
import InsightCard from "../components/insights/InsightCard.vue"
import RecorderStrip from "../components/insights/RecorderStrip.vue"
import SeverityBadge from "../components/insights/SeverityBadge.vue"
import { useFmt } from "../composables/use-fmt.ts"
import { useLoad } from "../composables/use-load.ts"
import { fmtDateTime } from "../i18n/format.ts"
import { DEMO_TRIP_ID } from "../fixtures/insights.ts"
import { activeAlerts, batteryTone, engineTone, fuelSummary, verdictOf } from "../model/insights.ts"

const { backend, lang, t, go } = useApp()
const f = useFmt()
const load = useLoad(
  () => backend.overview(lang.value),
  () => `${lang.value}:${backend.insightsDemo.value}`
)
const o = computed(() => load.data.value)

const lastTripId = computed(() => {
  const latest = [...backend.trips.value].sort((a, b) => b.startedAt - a.startedAt)[0]
  return latest?.tripId ?? (backend.insightsDemo.value ? DEMO_TRIP_ID : null)
})
const lastTrip = useLoad(
  async () => (lastTripId.value ? backend.tripInsight(lastTripId.value, lang.value) : null),
  () => `${lastTripId.value}:${lang.value}:${o.value?.generatedAt ?? 0}`
)

const verdict = computed(() => (o.value ? verdictOf(o.value) : "ok"))
const alerts = computed(() => (o.value ? activeAlerts(o.value.alerts) : []))
const fuel = computed(() => (o.value ? fuelSummary(o.value.byWeek) : null))
const codes = computed(() => o.value?.engine.activeCodes ?? [])
</script>

<template>
  <div class="screen overview" data-testid="overview">
    <RecorderStrip />
    <DemoChip />
    <AsyncState :loading="load.loading.value" :error="load.error.value" :has-data="!!o" @retry="load.reload">
      <template v-if="o">
        <section
          class="hero"
          :class="`tone-${verdict === 'ok' ? 'ok' : verdict}`"
          data-testid="verdict"
          :data-verdict="verdict"
        >
          <p class="hero-kicker">{{ t("overview.kicker") }}</p>
          <h2 class="hero-title">{{ t(`overview.verdict.${verdict}`) }}</h2>
          <p class="hero-text">{{ t(`overview.verdict.${verdict}.text`) }}</p>
        </section>

        <div class="icard-grid">
          <InsightCard
            :title="t('overview.engine')"
            :tone="engineTone(o)"
            testid="card-engine"
            @open="go({ name: 'engine' })"
          >
            <b class="icard-value" data-testid="engine-value">{{
              codes.length === 0 ? t("overview.engine.none") : t("overview.engine.codes", { n: codes.length })
            }}</b>
            <span class="icard-sub">{{
              o.engine.milOn ? t("overview.engine.lampOn") : t("overview.engine.lampOff")
            }}</span>
          </InsightCard>
          <InsightCard
            :title="t('overview.battery')"
            :tone="batteryTone(o.battery.status)"
            testid="card-battery"
            @open="go({ name: 'battery' })"
          >
            <b class="icard-value">{{ t(`battery.short.${o.battery.status}`) }}</b>
            <span class="icard-sub">{{ t("overview.battery.rest") }} {{ f.volts(o.battery.lastRestingV) }}</span>
            <span class="icard-sub">{{ t("overview.battery.crank") }} {{ f.volts(o.battery.lastCrankMinV) }}</span>
          </InsightCard>
          <InsightCard :title="t('overview.fuel')" tone="muted" testid="card-fuel" wide @open="go({ name: 'stats' })">
            <template v-if="fuel">
              <b class="icard-value">{{ f.l100(fuel.recent) }}</b>
              <span class="icard-sub">
                <template v-if="fuel.usual !== null"
                  >{{ t("overview.fuel.usual", { v: f.l100(fuel.usual) }) }} ·
                  {{ f.signedPct(fuel.deltaPct) }}</template
                >
                <template v-else>{{ t("overview.fuel.noUsual") }}</template>
              </span>
              <span class="icard-note">{{ t("overview.fuel.estimate") }}</span>
            </template>
            <span v-else class="icard-sub">{{ t("overview.fuel.none") }}</span>
          </InsightCard>
          <InsightCard
            v-if="lastTripId"
            :title="t('overview.lastTrip')"
            tone="muted"
            testid="card-trip"
            wide
            @open="go({ name: 'trip', tripId: lastTripId })"
          >
            <template v-if="lastTrip.data.value">
              <b class="icard-value">{{ f.km(lastTrip.data.value.distanceKm) }}</b>
              <span class="icard-sub"
                >{{ fmtDateTime(lang, lastTrip.data.value.startedAt) }} · {{ f.dur(lastTrip.data.value.durationS) }} ·
                {{ f.l100(lastTrip.data.value.fuelPer100Km) }}</span
              >
              <span v-if="!lastTrip.data.value.complete" class="icard-note">{{ t("trip.incomplete.short") }}</span>
            </template>
            <span v-else class="icard-sub">{{ t("overview.lastTrip.open") }}</span>
          </InsightCard>
        </div>

        <section v-if="alerts.length" class="block" data-testid="overview-alerts">
          <h3 class="section">{{ t("overview.alerts") }}</h3>
          <button
            v-for="a in alerts.slice(0, 3)"
            :key="a.id"
            class="alert-row"
            type="button"
            @click="go({ name: 'alerts' })"
          >
            <SeverityBadge :severity="a.severity" />
            <span class="alert-title">{{ a.title }}</span>
            <span class="icard-chev" aria-hidden="true">›</span>
          </button>
          <button v-if="alerts.length > 3" class="link" type="button" @click="go({ name: 'alerts' })">
            {{ t("overview.alerts.all", { n: alerts.length }) }}
          </button>
        </section>
        <p v-else class="calm" data-testid="no-alerts">{{ t("overview.alerts.none") }}</p>

        <button class="btn" type="button" data-testid="open-stats" @click="go({ name: 'stats' })">
          {{ t("overview.stats") }}
        </button>
      </template>
    </AsyncState>
  </div>
</template>
