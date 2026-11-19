<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"

const { backend, t, route, perform } = useApp()
const primary = computed<{ id: "connect" | "start" | "stop"; text: string; disabled: boolean } | null>(() => {
  const r = backend.rec.value
  if (r._tag === "Finishing") return { id: "stop", text: t.value("rec.finishing.title"), disabled: true }
  if (r._tag === "Recording") return { id: "stop", text: t.value("action.stop"), disabled: false }
  const n = route.value.name
  if (n === "connect" || n === "settings" || n === "pair" || n === "trip") return null
  if (backend.conn.value._tag === "Ready") return { id: "start", text: t.value("action.start"), disabled: false }
  return { id: "connect", text: t.value("action.connect"), disabled: false }
})
const onClick = () => {
  const p = primary.value
  if (!p) return
  if (p.id === "stop" && !window.confirm(t.value("recording.stopConfirm"))) return
  void perform(p.id)
}
</script>

<template>
  <div v-if="primary" class="primary-bar">
    <button class="btn btn-primary btn-big" type="button" :disabled="primary.disabled" data-testid="primary" :class="{ danger: primary.id === 'stop' }" @click="onClick">
      {{ primary.text }}
    </button>
  </div>
</template>
