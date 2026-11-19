<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import StatusCard from "../components/StatusCard.vue"
import TripRow from "../components/TripRow.vue"
import { describeHome } from "../model/home.ts"

const { backend, lang, now, t, go, installPrompt, perform } = useApp()
const view = computed(() =>
  describeHome({ conn: backend.conn.value, rec: backend.rec.value, sync: backend.sync.value, trips: backend.trips.value }, lang.value, now.value)
)
const recent = computed(() => [...backend.trips.value].sort((a, b) => b.startedAt - a.startedAt).slice(0, 3))
</script>

<template>
  <div class="screen">
    <StatusCard :view="view" big :trip-id="view.action?.id === 'openTrip' ? backend.trips.value.find((x) => x.sync._tag === 'Incomplete')?.tripId : undefined" />
    <section v-if="installPrompt" class="card">
      <h3>{{ t("pwa.title") }}</h3>
      <p>{{ t("pwa.text") }}</p>
      <button class="btn" type="button" @click="perform('install')">{{ t("action.install") }}</button>
    </section>
    <h3 class="section">{{ t("home.recentTrips") }}</h3>
    <p v-if="recent.length === 0" class="muted">{{ t("home.noTrips") }}</p>
    <TripRow v-for="x in recent" :key="x.tripId" :trip="x" />
    <button v-if="recent.length" class="link" type="button" @click="go({ name: 'trips' })">{{ t("action.openTrips") }}</button>
  </div>
</template>
