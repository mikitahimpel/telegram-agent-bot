<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import type { MessageKey } from "../i18n/index.ts"
import OnboardingArt, { type ArtId } from "../components/insights/OnboardingArt.vue"

type Step = { id: "adapter" | "buy" | "port" | "connect" | "home" | "tips"; art: ArtId }
const STEPS: Step[] = [
  { id: "adapter", art: "adapter" },
  { id: "buy", art: "buy" },
  { id: "port", art: "port" },
  { id: "connect", art: "connect" },
  { id: "home", art: "home" },
  { id: "tips", art: "tips" }
]
const ONBOARDED = "car-onboarded"

const { t, go, back, backend, installPrompt, perform } = useApp()
const index = ref(0)
const step = computed(() => STEPS[index.value]!)
const last = computed(() => index.value === STEPS.length - 1)

const next = (skipBuy = false) => {
  index.value = Math.min(STEPS.length - 1, index.value + (skipBuy ? 2 : 1))
}
const prev = () => {
  if (index.value === 2 && !wentBuy.value) index.value = 0
  else index.value = Math.max(0, index.value - 1)
}
const wentBuy = ref(true)
const haveAdapter = () => {
  wentBuy.value = false
  next(true)
}
const needAdapter = () => {
  wentBuy.value = true
  next()
}
const finish = () => {
  try {
    localStorage.setItem(ONBOARDED, "1")
  } catch {
  }
  if (backend.pairing.value === "paired") go({ name: "overview" })
  else back()
}
const BULLET_COUNT: Record<Step["id"], number> = { adapter: 0, buy: 3, port: 3, connect: 4, home: 3, tips: 4 }
const bullets = computed(() => Array.from({ length: BULLET_COUNT[step.value.id] }, (_, n) => `onboarding.${step.value.id}.b${n + 1}`))
</script>

<template>
  <div class="screen solo onboarding" data-testid="onboarding">
    <header class="ob-top">
      <ol class="dots" :aria-label="t('onboarding.progress', { n: index + 1, total: STEPS.length })">
        <li v-for="(s, i) in STEPS" :key="s.id" :class="{ on: i === index, done: i < index }" />
      </ol>
      <button class="link" type="button" data-testid="ob-skip" @click="finish">{{ t("onboarding.skip") }}</button>
    </header>
    <OnboardingArt :id="step.art" />
    <p class="ob-kicker">{{ t("onboarding.progress", { n: index + 1, total: STEPS.length }) }}</p>
    <h2 class="ob-title" data-testid="ob-title">{{ t(`onboarding.${step.id}.title`) }}</h2>
    <p class="ob-text">{{ t(`onboarding.${step.id}.text`) }}</p>
    <ul v-if="bullets.length" class="list ob-list">
      <li v-for="b in bullets" :key="b">{{ t(b as MessageKey) }}</li>
    </ul>
    <p v-if="step.id === 'buy'" class="notice warn" role="note" data-testid="ob-warning">{{ t("onboarding.buy.warning") }}</p>
    <button v-if="step.id === 'home' && installPrompt" class="btn" type="button" @click="perform('install')">{{ t("action.install") }}</button>
    <div class="ob-actions">
      <template v-if="step.id === 'adapter'">
        <button class="btn btn-primary btn-big" type="button" data-testid="ob-have" @click="haveAdapter">{{ t("onboarding.adapter.have") }}</button>
        <button class="btn btn-big" type="button" data-testid="ob-need" @click="needAdapter">{{ t("onboarding.adapter.need") }}</button>
      </template>
      <template v-else>
        <button v-if="!last" class="btn btn-primary btn-big" type="button" data-testid="ob-next" @click="next()">{{ t("onboarding.next") }}</button>
        <button v-else class="btn btn-primary btn-big" type="button" data-testid="ob-done" @click="finish">{{ t("onboarding.done") }}</button>
        <button class="btn" type="button" @click="prev">{{ t("common.back") }}</button>
      </template>
    </div>
  </div>
</template>
