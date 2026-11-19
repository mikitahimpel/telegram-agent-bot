<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import ChunkGrid from "../components/ChunkGrid.vue"
import GapTimeline from "../components/GapTimeline.vue"
import StatusCard from "../components/StatusCard.vue"
import { fmtDateTime, fmtNumber } from "../i18n/format.ts"
import { describeStatus } from "../model/describe-status.ts"
import { canDeleteLocal, tripCounters } from "../model/trips.ts"

const props = defineProps<{ tripId: string }>()
const { backend, t, lang, now, back } = useApp()
const trip = computed(() => backend.trips.value.find((x) => x.tripId === props.tripId) ?? null)
const view = computed(() =>
  trip.value ? describeStatus({ kind: "trip", state: trip.value.sync, localCopyLost: !trip.value.localCopy }, lang.value, now.value) : null
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
</script>

<template>
  <div v-if="!trip || !view || !counters" class="screen">
    <p class="card">{{ t("trip.notFound") }}</p>
  </div>
  <div v-else class="screen">
    <h2 class="trip-title">{{ fmtDateTime(lang, trip.startedAt) }}</h2>
    <StatusCard :view="view" :trip-id="trip.tripId" big />

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

    <h3 class="section">{{ t("trip.chunks") }}</h3>
    <p class="muted">{{ t("trip.chunks.hint") }}</p>
    <ChunkGrid :chunks="trip.chunks" />

    <h3 class="section">{{ t("trip.gaps") }}</h3>
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

    <div v-if="confirmDelete" class="modal" role="dialog" aria-modal="true" data-testid="delete-dialog">
      <div class="card">
        <p>{{ t("trip.delete.confirm") }}</p>
        <button class="btn btn-danger" type="button" @click="doDelete">{{ t("trip.delete.confirmYes") }}</button>
        <button class="btn" type="button" @click="confirmDelete = false">{{ t("common.cancel") }}</button>
      </div>
    </div>
  </div>
</template>
