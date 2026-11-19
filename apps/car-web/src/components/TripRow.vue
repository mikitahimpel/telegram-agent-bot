<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import { fmtClock, fmtDateTime, fmtNumber } from "../i18n/format.ts"
import { describeStatus } from "../model/describe-status.ts"
import type { TripVm } from "../model/types.ts"

const props = defineProps<{ trip: TripVm }>()
const { t, lang, now, go } = useApp()
const view = computed(() => describeStatus({ kind: "trip", state: props.trip.sync, localCopyLost: !props.trip.localCopy }, lang.value, now.value))
const duration = computed(() => (props.trip.endedAt ? fmtClock(props.trip.endedAt - props.trip.startedAt) : null))
</script>

<template>
  <button class="card trip-row" :class="`tone-${view.tone}`" type="button" data-testid="trip-row" @click="go({ name: 'trip', tripId: trip.tripId })">
    <div class="trip-row-head">
      <strong>{{ fmtDateTime(lang, trip.startedAt) }}</strong>
      <span class="badge" :class="`tone-${view.tone}`">{{ view.icon }} {{ view.title.split(":")[0] }}</span>
    </div>
    <div class="muted">
      <template v-if="duration">{{ duration }} · </template>{{ trip.distanceKm !== null ? t("trips.distance", { km: fmtNumber(lang, trip.distanceKm) }) : t("trips.unknownDistance") }} ·
      {{ t("trips.points", { n: trip.points }) }}
    </div>
    <div class="trip-summary">{{ view.summary ?? view.text }}</div>
  </button>
</template>
