<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import { describeStatus, type StatusView } from "../model/describe-status.ts"
import StatusCard from "./StatusCard.vue"

const { backend, lang, now } = useApp()

const banners = computed<{ key: string; view: StatusView }[]>(() => {
  const out: { key: string; view: StatusView }[] = []
  const add = (key: string, view: StatusView | null) => view && out.push({ key, view })
  const s = backend.sync.value
  if (backend.pairing.value !== "paired") add("local", describeStatus({ kind: "pair", state: "localOnly" }, lang.value, now.value))
  if (backend.pairing.value === "paired") {
    if (!backend.online.value || s._tag === "Offline") add("offline", describeStatus({ kind: "sync", state: { _tag: "Offline" } }, lang.value, now.value))
    if (s._tag === "NeedsReauth" || s._tag === "Blocked") add("sync", describeStatus({ kind: "sync", state: s }, lang.value, now.value))
  }
  const st = backend.storage.value
  if (st) {
    const pct = (st.usedBytes / st.quotaBytes) * 100
    if (pct >= 80) add("storage", describeStatus({ kind: "storage", level: "low", usedPct: pct }, lang.value, now.value))
    else if (!st.persisted) add("persist", describeStatus({ kind: "storage", level: "notPersistent" }, lang.value, now.value))
  }
  if (Math.abs(backend.clockOffsetMs.value) > 120_000) add("clock", describeStatus({ kind: "clock", offsetMs: backend.clockOffsetMs.value }, lang.value, now.value))
  return out
})
</script>

<template>
  <div v-if="banners.length" class="banners" data-testid="banners">
    <StatusCard v-for="b in banners" :key="b.key" :view="b.view" class="banner" />
  </div>
</template>
