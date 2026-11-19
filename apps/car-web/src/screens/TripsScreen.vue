<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import TripRow from "../components/TripRow.vue"
import { groupTrips, type TripGroup } from "../model/trips.ts"

const { backend, t } = useApp()
const groups = computed(() => groupTrips(backend.trips.value))
const order: TripGroup[] = ["attention", "inProgress", "done"]
</script>

<template>
  <div class="screen">
    <div v-if="backend.trips.value.length === 0" class="card empty" data-testid="trips-empty">
      <h2>{{ t("trips.empty") }}</h2>
      <p>{{ t("trips.empty.text") }}</p>
    </div>
    <template v-for="g in order" :key="g">
      <section v-if="groups[g].length" :data-testid="`group-${g}`">
        <h3 class="section">{{ t(`trips.${g}`) }}</h3>
        <TripRow v-for="x in groups[g]" :key="x.tripId" :trip="x" />
      </section>
    </template>
  </div>
</template>
