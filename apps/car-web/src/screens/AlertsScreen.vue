<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import AsyncState from "../components/insights/AsyncState.vue"
import DemoChip from "../components/insights/DemoChip.vue"
import SeverityBadge from "../components/insights/SeverityBadge.vue"
import { useLoad } from "../composables/use-load.ts"
import { fmtDateTime } from "../i18n/format.ts"
import { activeAlerts } from "../model/insights.ts"

const { backend, lang, t, go } = useApp()
const load = useLoad(() => backend.alerts(lang.value), () => `${lang.value}:${backend.insightsDemo.value}`)
const active = computed(() => activeAlerts(load.data.value ?? []))
const resolved = computed(() => (load.data.value ?? []).filter((a) => a.resolvedAt !== null))
</script>

<template>
  <div class="screen alerts" data-testid="alerts-screen">
    <DemoChip />
    <AsyncState :loading="load.loading.value" :error="load.error.value" :has-data="!!load.data.value" @retry="load.reload">
      <section v-if="active.length === 0" class="hero tone-ok" data-testid="alerts-empty">
        <h2 class="hero-title">{{ t("alerts.empty.title") }}</h2>
        <p class="hero-text">{{ t("alerts.empty.text") }}</p>
      </section>
      <article v-for="a in active" :key="a.id" class="card alert-card" :class="`sev-border-${a.severity}`" data-testid="alert">
        <SeverityBadge :severity="a.severity" />
        <h3>{{ a.title }}</h3>
        <p>{{ a.details }}</p>
        <div class="can-drive" :class="`sev-${a.severity}`">
          <span class="can-drive-label">{{ t("alerts.whatToDo") }}</span>
          {{ a.whatToDo }}
        </div>
        <p class="muted">{{ t("alerts.since", { at: fmtDateTime(lang, a.createdAt) }) }}</p>
        <button v-if="a.kind === 'check_engine'" class="link" type="button" @click="go({ name: 'engine' })">{{ t("alerts.openEngine") }}</button>
        <button v-else-if="a.kind === 'battery_weak' || a.kind === 'charging_problem'" class="link" type="button" @click="go({ name: 'battery' })">{{ t("alerts.openBattery") }}</button>
        <button v-else-if="a.tripId" class="link" type="button" @click="go({ name: 'trip', tripId: a.tripId })">{{ t("alerts.openTrip") }}</button>
      </article>
      <details v-if="resolved.length" class="card fold" data-testid="alerts-resolved">
        <summary>{{ t("alerts.resolved", { n: resolved.length }) }}</summary>
        <div v-for="a in resolved" :key="a.id" class="hist">
          <b>{{ a.title }}</b>
          <p class="muted">{{ fmtDateTime(lang, a.createdAt) }} – {{ fmtDateTime(lang, a.resolvedAt ?? a.createdAt) }}</p>
        </div>
      </details>
    </AsyncState>
  </div>
</template>
