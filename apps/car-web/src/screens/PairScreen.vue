<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import StatusCard from "../components/StatusCard.vue"
import { describeStatus } from "../model/describe-status.ts"

const props = defineProps<{ retry?: () => void }>()
const { backend, lang } = useApp()
const state = computed(() => (backend.pairing.value === "paired" ? "unpaired" : backend.pairing.value))
const view = computed(() => describeStatus({ kind: "pair", state: state.value }, lang.value))
</script>

<template>
  <div class="screen solo" data-testid="pair-screen">
    <StatusCard :view="view" big @action="(id) => id === 'retry' && props.retry?.()" />
  </div>
</template>
