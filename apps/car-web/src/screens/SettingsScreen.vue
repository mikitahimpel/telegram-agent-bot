<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import { fmtBytes, fmtDateTime, fmtTime } from "../i18n/format.ts"
import type { Lang } from "../i18n/index.ts"

const { backend, t, lang, setLang, go } = useApp()
const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"
const denied = ref(false)
const copied = ref(false)
const intervals = [250, 500, 1000, 2000]
const log = computed(() =>
  backend.diag.value
    .slice(-500)
    .map((e) => `${new Date(e.at).toISOString()} [${e.kind}] ${e.text}`)
    .join("\n")
)
const copyLog = async () => {
  try {
    await navigator.clipboard.writeText(log.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}
const request = async () => {
  denied.value = !(await backend.requestPersistence())
}
const onLang = (e: Event) => setLang((e.target as HTMLSelectElement).value as Lang)
const onPoll = (e: Event) => backend.setPollingMs(Number((e.target as HTMLSelectElement).value))
const revoke = async (id: string, name: string) => {
  if (window.confirm(t.value("devices.revokeConfirm", { name }))) await backend.revokeDevice(id)
}
</script>

<template>
  <div class="screen">
    <button class="btn" type="button" data-testid="open-onboarding" @click="go({ name: 'onboarding' })">
      {{ t("settings.howItWorks") }}
    </button>
    <section class="card">
      <label
        >{{ t("settings.language") }}
        <select :value="lang" data-testid="lang" @change="onLang">
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
    </section>

    <section class="card">
      <label
        >{{ t("settings.polling") }}
        <select :value="backend.pollingMs.value" @change="onPoll">
          <option v-for="n in intervals" :key="n" :value="n">{{ t("settings.polling.value", { n }) }}</option>
        </select>
      </label>
      <p class="muted">{{ t("settings.polling.hint") }}</p>
    </section>

    <section class="card" data-testid="storage">
      <h3>{{ t("settings.storage") }}</h3>
      <template v-if="backend.storage.value">
        <p>
          {{
            t("settings.storage.used", {
              used: fmtBytes(backend.storage.value.usedBytes),
              quota: fmtBytes(backend.storage.value.quotaBytes)
            })
          }}
        </p>
        <p>
          {{ backend.storage.value.persisted ? t("settings.storage.persisted") : t("settings.storage.notPersisted") }}
        </p>
        <button v-if="!backend.storage.value.persisted" class="btn" type="button" @click="request">
          {{ t("settings.storage.request") }}
        </button>
        <p v-if="denied" class="muted">{{ t("settings.storage.requestDenied") }}</p>
      </template>
    </section>

    <section class="card">
      <h3>{{ t("devices.title") }}</h3>
      <p v-if="backend.devices.value.length === 0" class="muted">{{ t("devices.empty") }}</p>
      <ul class="plain">
        <li v-for="d in backend.devices.value" :key="d.id">
          <strong>{{ d.name }}</strong><span v-if="d.current"> · {{ t("devices.thisOne") }}</span>
          <div v-if="d.lastSeenAt" class="muted">
            {{ t("devices.lastSeen", { when: fmtDateTime(lang, d.lastSeenAt) }) }}
          </div>
          <button v-if="!d.current" class="link" type="button" @click="revoke(d.id, d.name)">
            {{ t("action.revokeDevice") }}
          </button>
        </li>
      </ul>
    </section>

    <section class="card" data-testid="diag">
      <h3>{{ t("settings.diag") }}</h3>
      <p class="muted">{{ t("settings.diag.hint") }}</p>
      <pre class="details log">{{ log || t("settings.diag.empty") }}</pre>
      <button class="btn" type="button" @click="copyLog">
        {{ copied ? t("common.copied") : t("settings.diag.copy") }}
      </button>
    </section>

    <section class="card">
      <h3>{{ t("settings.about") }}</h3>
      <p>{{ t("settings.version", { v: version }) }}</p>
      <p class="muted">{{ fmtTime(lang, Date.now()) }}</p>
    </section>
  </div>
</template>
