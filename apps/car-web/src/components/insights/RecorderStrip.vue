<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../../app-context.ts"
import { describeAuto, type AutoActionId } from "../../model/describe-auto.ts"
import { describeHome } from "../../model/home.ts"

const { backend, lang, now, perform, go, t } = useApp()
const auto = computed(() => {
  void now.value
  return describeAuto(backend.auto.value, lang.value)
})
const home = computed(() => describeHome({ conn: backend.conn.value, rec: backend.rec.value, sync: backend.sync.value, trips: backend.trips.value }, lang.value, now.value))
const attention = computed(() => backend.trips.value.find((x) => x.sync._tag === "Incomplete")?.tripId)
const view = computed(() => auto.value ?? home.value)
const autoOff = computed(() => backend.auto.value._tag === "Off")

const runAuto = (id: AutoActionId) => {
  const s = backend.auto.value
  if (id === "chooseAdapter") void backend.connectAdapter()
  else if (id === "connectManually") void perform("connect")
  else if (id === "enable") void backend.enableAuto()
  else if (id === "openTrip" && s._tag === "AutoStopped") go({ name: "trip", tripId: s.tripId })
}
const runHome = () => {
  const a = home.value.action
  if (a) void perform(a.id, attention.value ? { tripId: attention.value } : {})
}
const run = () => (auto.value ? auto.value.action && runAuto(auto.value.action.id) : runHome())
const action = computed(() => (auto.value ? auto.value.action : home.value.action))
</script>

<template>
  <section class="strip" :class="[`tone-${view.tone}`, { big: !!auto }]" role="status" aria-live="polite" data-testid="recorder-strip" :data-auto="backend.auto.value._tag">
    <span class="strip-icon" aria-hidden="true">{{ view.icon }}</span>
    <div class="strip-body">
      <b>{{ view.title }}</b>
      <span>{{ view.text }}</span>
    </div>
    <button v-if="action" class="btn btn-small" type="button" data-testid="strip-action" @click="run">{{ action.label }}</button>
    <button v-if="autoOff && backend.caps.ble" class="link strip-enable" type="button" data-testid="auto-enable" @click="runAuto('enable')">{{ t("auto.enable") }}</button>
  </section>
</template>
