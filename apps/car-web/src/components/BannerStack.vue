<script setup lang="ts">
import { computed } from "vue"
import { useApp } from "../app-context.ts"
import { describeStatus, type StatusView } from "../model/describe-status.ts"
import StatusCard from "./StatusCard.vue"

const { backend, lang, now, t, go, dismissed } = useApp()

const unconfirmed = computed(
  () =>
    backend.rec.value._tag === "Recording" ||
    backend.trips.value.some((x) => x.localCopy && x.sync._tag !== "Confirmed" && x.sync._tag !== "CloudOnly")
)

const banners = computed<{ key: string; view: StatusView }[]>(() => {
  const out: { key: string; view: StatusView }[] = []
  const add = (key: string, view: StatusView | null) => view && out.push({ key, view })
  const s = backend.sync.value
  if (backend.pairing.value === "paired") {
    if (!backend.online.value || s._tag === "Offline")
      add("offline", describeStatus({ kind: "sync", state: { _tag: "Offline" } }, lang.value, now.value))
    if (s._tag === "NeedsReauth" || s._tag === "Blocked")
      add("sync", describeStatus({ kind: "sync", state: s }, lang.value, now.value))
  }
  const st = backend.storage.value
  if (st && (st.usedBytes / st.quotaBytes) * 100 >= 80)
    add(
      "storage",
      describeStatus(
        { kind: "storage", level: "low", usedPct: (st.usedBytes / st.quotaBytes) * 100 },
        lang.value,
        now.value
      )
    )
  if (Math.abs(backend.clockOffsetMs.value) > 120_000)
    add("clock", describeStatus({ kind: "clock", offsetMs: backend.clockOffsetMs.value }, lang.value, now.value))
  return out
})

const showUnpaired = computed(() => backend.pairing.value !== "paired")
const showPersist = computed(
  () =>
    !!backend.storage.value &&
    !backend.storage.value.persisted &&
    unconfirmed.value &&
    !dismissed.value.includes("persist")
)
const dismiss = (k: string) => dismissed.value.push(k)
</script>

<template>
  <div v-if="banners.length || showUnpaired || showPersist" class="banners" data-testid="banners">
    <div v-if="showUnpaired" class="banner-line" data-testid="banner-unpaired">
      <span>{{ t("banner.unpaired") }}</span>
      <button class="link" type="button" @click="go({ name: 'pair' })">{{ t("banner.connectLink") }}</button>
    </div>
    <div v-if="showPersist" class="banner-line" data-testid="banner-persist">
      <span>{{ t("banner.persist") }}</span>
      <button class="link" type="button" @click="backend.requestPersistence()">{{ t("banner.persistAction") }}</button>
      <button class="dismiss" type="button" :aria-label="t('banner.dismiss')" @click="dismiss('persist')">×</button>
    </div>
    <StatusCard v-for="b in banners" :key="b.key" :view="b.view" class="banner" />
  </div>
</template>
