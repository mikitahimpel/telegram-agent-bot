<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import StatusCard from "../components/StatusCard.vue"
import { describeStatus } from "../model/describe-status.ts"
import type { SimScenario, TransportKind } from "../model/types.ts"
import { wizardSteps } from "../model/wizard.ts"

const props = defineProps<{ preset?: TransportKind }>()
const { backend, t, lang, now, perform } = useApp()
const transport = ref<TransportKind>(props.preset ?? (backend.caps.ble ? "ble" : backend.caps.serial ? "serial" : "simulator"))
const scenario = ref<SimScenario>("normal")
const dev = ref(false)
let taps = 0
const tapTitle = () => {
  if (++taps >= 5) dev.value = !dev.value
  if (taps >= 5) taps = 0
}
const scenarios: SimScenario[] = ["normal", "ignition_off", "clone_garbage", "drops_every_60s", "slow_ecu", "no_fuel_pid"]
const transports = computed(() => [
  { id: "ble" as const, ok: backend.caps.ble },
  { id: "serial" as const, ok: backend.caps.serial },
  { id: "simulator" as const, ok: true }
])
const steps = computed(() => wizardSteps(backend.conn.value, backend.caps, transport.value, lang.value))
const view = computed(() => describeStatus({ kind: "connection", state: backend.conn.value }, lang.value, now.value))
const idle = computed(() => backend.conn.value._tag === "Idle" || backend.conn.value._tag === "Failed")
const busy = computed(() => !idle.value && backend.conn.value._tag !== "Ready")
const mark = { done: "✓", active: "…", failed: "!", pending: "" } as const
</script>

<template>
  <div class="screen">
    <h2 data-testid="connect-title" @click="tapTitle">{{ t("connect.title") }}</h2>

    <h3 class="section">{{ t("connect.transport") }}</h3>
    <div class="transports" role="radiogroup">
      <button
        v-for="x in transports"
        :key="x.id"
        class="transport"
        :class="{ selected: transport === x.id }"
        type="button"
        role="radio"
        :aria-checked="transport === x.id"
        :disabled="!idle || !x.ok"
        :data-testid="`transport-${x.id}`"
        @click="transport = x.id"
      >
        <strong>{{ t(`connect.transport.${x.id}`) }}</strong>
        <small>{{ x.ok ? t(`connect.transport.${x.id}.hint`) : t("connect.unavailable") }}</small>
      </button>
    </div>

    <div v-if="dev && transport === 'simulator'" class="card" data-testid="dev-menu">
      <h3>{{ t("connect.dev") }}</h3>
      <label>
        {{ t("connect.dev.scenario") }}
        <select v-model="scenario">
          <option v-for="s in scenarios" :key="s" :value="s">{{ t(`connect.scenario.${s}`) }}</option>
        </select>
      </label>
    </div>

    <h3 class="section">{{ t("connect.steps") }}</h3>
    <ol class="steps-list" data-testid="wizard">
      <li v-for="s in steps" :key="s.id" :class="`step-${s.status}`" :data-step="s.id" :data-status="s.status">
        <span class="step-mark" aria-hidden="true">{{ mark[s.status] }}</span>
        <div>
          <div class="step-label">{{ s.note ?? s.label }}</div>
          <div v-if="s.problem" class="step-problem">
            <strong>{{ s.problem.title }}</strong>
            <p>{{ s.problem.text }}</p>
            <pre v-if="s.problem.details" class="details">{{ s.problem.details }}</pre>
          </div>
        </div>
      </li>
    </ol>

    <StatusCard v-if="backend.conn.value._tag !== 'Idle' && backend.conn.value._tag !== 'Failed'" :view="view" />

    <div class="actions">
      <button v-if="backend.conn.value._tag === 'Ready'" class="btn btn-primary" type="button" data-testid="connect-start" @click="perform('start')">{{ t("action.start") }}</button>
      <button v-else-if="idle" class="btn btn-primary" type="button" data-testid="connect-go" @click="backend.connect(transport, scenario)">
        {{ backend.conn.value._tag === "Failed" ? t("common.retry") : t("connect.start") }}
      </button>
      <button v-if="busy" class="btn" type="button" @click="backend.cancelConnect()">{{ t("connect.cancel") }}</button>
      <button v-if="backend.conn.value._tag === 'Failed' && transport !== 'simulator'" class="link" type="button" @click="transport = 'simulator'">
        {{ t("action.tryDemo") }}
      </button>
    </div>
  </div>
</template>
