<script setup lang="ts">
import { ref } from "vue"
import { useApp } from "../app-context.ts"
import type { StatusView } from "../model/describe-status.ts"

const props = defineProps<{ view: StatusView; big?: boolean; tripId?: string }>()
const emit = defineEmits<{ action: [id: string] }>()
const { t, perform } = useApp()
const open = ref(false)
const run = () => {
  const a = props.view.action
  if (!a) return
  emit("action", a.id)
  void perform(a.id, props.tripId ? { tripId: props.tripId } : {})
}
</script>

<template>
  <section class="card status" :class="[`tone-${view.tone}`, { big }]" role="status" aria-live="polite" data-testid="status-card">
    <div class="status-head">
      <span class="status-icon" aria-hidden="true">{{ view.icon }}</span>
      <h2 class="status-title">{{ view.title }}</h2>
    </div>
    <p class="status-text">{{ view.text }}</p>
    <button v-if="view.action" class="btn btn-primary" type="button" data-testid="status-action" @click="run">
      {{ view.action.label }}
    </button>
    <button v-if="view.details" class="link" type="button" :aria-expanded="open" @click="open = !open">
      {{ t("common.details") }} {{ open ? "▴" : "▾" }}
    </button>
    <pre v-if="open && view.details" class="details">{{ view.details }}</pre>
  </section>
</template>
