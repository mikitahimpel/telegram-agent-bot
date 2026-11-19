<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import StatusCard from "../components/StatusCard.vue"
import { botUrl } from "../services/env.ts"
import { describeStatus } from "../model/describe-status.ts"

const props = defineProps<{ retry?: () => void }>()
const { backend, lang, t, perform, localMode, go } = useApp()
const bot = botUrl(import.meta.env.VITE_BOT_USERNAME as string | undefined)
const showActions = computed(() => backend.pairing.value !== "progress")
const recordLocally = () => {
  localMode.value = true
  go({ name: "home" })
}
const state = computed(() => (backend.pairing.value === "paired" ? "unpaired" : backend.pairing.value))
const view = computed(() => describeStatus({ kind: "pair", state: state.value }, lang.value))
</script>

<template>
  <div class="screen solo" data-testid="pair-screen">
    <StatusCard :view="view" big @action="(id) => id === 'retry' && props.retry?.()" />
    <template v-if="showActions">
      <a v-if="bot" class="btn btn-primary btn-big" :href="bot" target="_blank" rel="noopener" data-testid="open-bot">{{ t("pair.openBot") }}</a>
      <button class="btn" type="button" data-testid="record-local" @click="recordLocally">{{ t("pair.recordLocal") }}</button>
      <button class="btn" type="button" data-testid="open-onboarding" @click="go({ name: 'onboarding' })">{{ t("pair.firstTime") }}</button>
      <button class="btn btn-link" type="button" data-testid="pair-demo" @click="localMode = true; perform('tryDemo')">{{ t("pair.demo") }}</button>
    </template>
  </div>
</template>
