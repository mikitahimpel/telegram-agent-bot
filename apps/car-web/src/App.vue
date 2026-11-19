<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue"
import { useApp } from "./app-context.ts"
import BannerStack from "./components/BannerStack.vue"
import PrimaryBar from "./components/PrimaryBar.vue"
import { describeStatus } from "./model/describe-status.ts"
import ConnectScreen from "./screens/ConnectScreen.vue"
import HomeScreen from "./screens/HomeScreen.vue"
import InterruptedDialog from "./screens/InterruptedDialog.vue"
import OpenInChromeScreen from "./screens/OpenInChromeScreen.vue"
import PairScreen from "./screens/PairScreen.vue"
import RecordingScreen from "./screens/RecordingScreen.vue"
import SettingsScreen from "./screens/SettingsScreen.vue"
import TripDetailScreen from "./screens/TripDetailScreen.vue"
import TripsScreen from "./screens/TripsScreen.vue"
import { isTelegramWebview } from "./services/env.ts"

const props = defineProps<{ retryPairing?: () => void }>()
const { backend, route, go, back, canGoBack, t, lang, localMode } = useApp()

const unsupported = computed(
  () =>
    describeStatus(
      { kind: "env", caps: backend.caps, platform: backend.platform, telegramWebview: isTelegramWebview(typeof navigator === "undefined" ? "" : navigator.userAgent) },
      lang.value
    ) !== null
)
const gate = computed<"unsupported" | "pair" | "app">(() => (unsupported.value ? "unsupported" : backend.pairing.value === "paired" || localMode.value || backend.conn.value._tag !== "Idle" || backend.rec.value._tag !== "Idle" ? "app" : "pair"))
const recording = computed(() => backend.rec.value._tag === "Recording")
const titleKey = computed(() => {
  const n = route.value.name
  return n === "home" ? "home.title" : n === "connect" ? "connect.title" : n === "recording" ? "recording.title" : n === "trips" ? "trips.title" : n === "trip" ? "trip.title" : n === "settings" ? "settings.title" : "pair.unpaired.title"
})

const beforeUnload = (e: BeforeUnloadEvent) => {
  if (!recording.value) return
  e.preventDefault()
  e.returnValue = t.value("recording.leaveWarning")
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload))
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload))

// Recording is the only place to be while a trip is open.
watch(recording, (on) => on && route.value.name !== "recording" && go({ name: "recording" }))
</script>

<template>
  <OpenInChromeScreen v-if="gate === 'unsupported'" />
  <PairScreen v-else-if="gate === 'pair'" :retry="props.retryPairing" />
  <div v-else class="shell">
    <header class="top">
      <button v-if="canGoBack" class="icon-btn" type="button" :aria-label="t('common.back')" data-testid="back" @click="back">‹</button>
      <h1>{{ t(titleKey) }}</h1>
    </header>
    <main>
      <BannerStack />
      <HomeScreen v-if="route.name === 'home'" />
      <ConnectScreen v-else-if="route.name === 'connect'" :preset="route.preset" />
      <RecordingScreen v-else-if="route.name === 'recording'" />
      <TripsScreen v-else-if="route.name === 'trips'" />
      <TripDetailScreen v-else-if="route.name === 'trip'" :trip-id="route.tripId" />
      <SettingsScreen v-else-if="route.name === 'settings'" />
      <PairScreen v-else />
    </main>
    <PrimaryBar />
    <nav class="tabs" aria-label="Main">
      <button type="button" :class="{ on: route.name === 'home' }" @click="go({ name: 'home' })">{{ t("nav.home") }}</button>
      <button type="button" :class="{ on: route.name === 'trips' || route.name === 'trip' }" @click="go({ name: 'trips' })">{{ t("nav.trips") }}</button>
      <button type="button" :class="{ on: route.name === 'settings' }" @click="go({ name: 'settings' })">{{ t("nav.settings") }}</button>
    </nav>
    <InterruptedDialog />
  </div>
</template>
