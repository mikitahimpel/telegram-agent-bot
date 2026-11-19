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
import AlertsScreen from "./screens/AlertsScreen.vue"
import BatteryScreen from "./screens/BatteryScreen.vue"
import EngineScreen from "./screens/EngineScreen.vue"
import OnboardingScreen from "./screens/OnboardingScreen.vue"
import OverviewScreen from "./screens/OverviewScreen.vue"
import StatsScreen from "./screens/StatsScreen.vue"
import TripsScreen from "./screens/TripsScreen.vue"
import { isTelegramWebview } from "./services/env.ts"

const props = defineProps<{ retryPairing?: () => void }>()
const { backend, route, go, back, canGoBack, t, lang, localMode, hashRouted } = useApp()

const unsupported = computed(
  () =>
    describeStatus(
      {
        kind: "env",
        caps: backend.caps,
        platform: backend.platform,
        telegramWebview: isTelegramWebview(typeof navigator === "undefined" ? "" : navigator.userAgent)
      },
      lang.value
    ) !== null
)
const gate = computed<"unsupported" | "pair" | "app">(() =>
  unsupported.value
    ? "unsupported"
    : backend.pairing.value === "paired" ||
        localMode.value ||
        backend.conn.value._tag !== "Idle" ||
        backend.rec.value._tag !== "Idle"
      ? "app"
      : "pair"
)
const recording = computed(() => backend.rec.value._tag === "Recording")
const titleKey = computed(() => {
  const n = route.value.name
  switch (n) {
    case "home":
      return "home.title"
    case "connect":
      return "connect.title"
    case "recording":
      return "recording.title"
    case "trips":
      return "trips.title"
    case "trip":
      return "trip.title"
    case "settings":
      return "settings.title"
    case "overview":
      return "overview.title"
    case "engine":
      return "engine.title"
    case "battery":
      return "battery.title"
    case "stats":
      return "stats.title"
    case "alerts":
      return "alerts.title"
    default:
      return "pair.unpaired.title"
  }
})
const overviewTabs = ["overview", "engine", "battery", "stats", "alerts"]

const beforeUnload = (e: BeforeUnloadEvent) => {
  if (!recording.value) return
  e.preventDefault()
  e.returnValue = t.value("recording.leaveWarning")
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload))
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload))

watch(
  () => backend.pairing.value,
  (p) => {
    if (p === "paired" && route.value.name === "home" && !hashRouted) route.value = { name: "overview" }
  },
  { immediate: true }
)
watch(recording, (on) => on && route.value.name !== "recording" && go({ name: "recording" }))
</script>

<template>
  <OpenInChromeScreen v-if="gate === 'unsupported'" />
  <OnboardingScreen v-else-if="route.name === 'onboarding'" />
  <PairScreen v-else-if="gate === 'pair'" :retry="props.retryPairing" />
  <div v-else class="shell">
    <header class="top">
      <button
        v-if="canGoBack"
        class="icon-btn"
        type="button"
        :aria-label="t('common.back')"
        data-testid="back"
        @click="back"
      >
        ‹
      </button>
      <h1>{{ t(titleKey) }}</h1>
    </header>
    <main>
      <BannerStack />
      <OverviewScreen v-if="route.name === 'overview'" />
      <EngineScreen v-else-if="route.name === 'engine'" />
      <BatteryScreen v-else-if="route.name === 'battery'" />
      <StatsScreen v-else-if="route.name === 'stats'" />
      <AlertsScreen v-else-if="route.name === 'alerts'" />
      <HomeScreen v-else-if="route.name === 'home'" />
      <ConnectScreen v-else-if="route.name === 'connect'" :preset="route.preset" />
      <RecordingScreen v-else-if="route.name === 'recording'" />
      <TripsScreen v-else-if="route.name === 'trips'" />
      <TripDetailScreen v-else-if="route.name === 'trip'" :trip-id="route.tripId" />
      <SettingsScreen v-else-if="route.name === 'settings'" />
      <PairScreen v-else />
    </main>
    <PrimaryBar />
    <nav class="tabs" aria-label="Main">
      <button
        type="button"
        :class="{ on: overviewTabs.includes(route.name) }"
        data-testid="tab-overview"
        @click="go({ name: 'overview' })"
      >
        {{ t("nav.overview") }}
      </button>
      <button
        type="button"
        :class="{ on: route.name === 'trips' || route.name === 'trip' }"
        @click="go({ name: 'trips' })"
      >
        {{ t("nav.trips") }}
      </button>
      <button
        type="button"
        :class="{ on: route.name === 'home' || route.name === 'connect' || route.name === 'recording' }"
        @click="go({ name: 'home' })"
      >
        {{ t("nav.home") }}
      </button>
      <button type="button" :class="{ on: route.name === 'settings' }" @click="go({ name: 'settings' })">
        {{ t("nav.settings") }}
      </button>
    </nav>
    <InterruptedDialog />
  </div>
</template>
