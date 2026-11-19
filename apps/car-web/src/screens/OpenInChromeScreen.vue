<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import StatusCard from "../components/StatusCard.vue"
import { describeStatus } from "../model/describe-status.ts"
import { isTelegramWebview } from "../services/env.ts"

const { backend, lang, t } = useApp()
const copied = ref(false)
const href = typeof window === "undefined" ? "" : window.location.href
const view = computed(
  () =>
    describeStatus(
      {
        kind: "env",
        caps: backend.caps,
        platform: backend.platform,
        telegramWebview: isTelegramWebview(typeof navigator === "undefined" ? "" : navigator.userAgent)
      },
      lang.value
    ) ??
    describeStatus({ kind: "env", caps: backend.caps, platform: backend.platform, telegramWebview: false }, lang.value)
)
const canIntent = computed(() => backend.platform === "android")
const copy = async () => {
  try {
    await navigator.clipboard.writeText(href)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="screen solo" data-testid="open-in-chrome">
    <StatusCard v-if="view" :view="view" big />
    <template v-if="canIntent">
      <section class="card">
        <h3>{{ t("chrome.fallback") }}</h3>
        <pre class="steps">{{ t("chrome.steps") }}</pre>
        <input
          class="link-box"
          readonly
          :value="href"
          aria-label="URL"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <button class="btn" type="button" @click="copy">
          {{ copied ? t("chrome.linkCopied") : t("chrome.copyLink") }}
        </button>
      </section>
    </template>
  </div>
</template>
