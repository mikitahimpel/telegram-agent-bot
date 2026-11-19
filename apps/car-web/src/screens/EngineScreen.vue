<script setup lang="ts">
import { computed, ref } from "vue"
import { useApp } from "../app-context.ts"
import AsyncState from "../components/insights/AsyncState.vue"
import DemoChip from "../components/insights/DemoChip.vue"
import SeverityBadge from "../components/insights/SeverityBadge.vue"
import { useLoad } from "../composables/use-load.ts"
import { fmtDateTime } from "../i18n/format.ts"
import { bySeverityDesc, codeKindKey } from "../model/insights.ts"
import type { DtcScanOutcome } from "../model/types.ts"

const { backend, lang, t, go } = useApp()
const load = useLoad(
  () => backend.overview(lang.value),
  () => `${lang.value}:${backend.insightsDemo.value}`
)
const history = useLoad(
  async () => (await backend.alerts(lang.value)).filter((a) => a.kind === "check_engine" && a.resolvedAt !== null),
  () => `${lang.value}:${backend.insightsDemo.value}`
)
const o = computed(() => load.data.value)
const codes = computed(() => bySeverityDesc(o.value?.engine.activeCodes ?? []))

const scanning = ref(false)
const scanResult = ref<DtcScanOutcome | null>(null)
const scan = async () => {
  scanning.value = true
  scanResult.value = null
  try {
    scanResult.value = await backend.scanDtc()
    if (scanResult.value._tag === "Done") await load.reload()
  } finally {
    scanning.value = false
  }
}
</script>

<template>
  <div class="screen engine" data-testid="engine-screen">
    <DemoChip />
    <AsyncState :loading="load.loading.value" :error="load.error.value" :has-data="!!o" @retry="load.reload">
      <template v-if="o">
        <section v-if="codes.length === 0" class="hero tone-ok" data-testid="engine-clear">
          <h2 class="hero-title">{{ t("engine.clear.title") }}</h2>
          <p class="hero-text">{{ t("engine.clear.text") }}</p>
        </section>
        <section v-else class="hero" :class="`tone-${codes[0]!.severity}`" data-testid="engine-issues">
          <h2 class="hero-title">{{ t("engine.issues.title", { n: codes.length }) }}</h2>
          <p class="hero-text">{{ o.engine.milOn ? t("engine.lampOn") : t("engine.lampOff") }}</p>
        </section>

        <section class="block">
          <button class="btn btn-primary btn-big" type="button" data-testid="scan" :disabled="scanning" @click="scan">
            {{ scanning ? t("engine.scan.running") : t("engine.scan") }}
          </button>
          <p class="muted" data-testid="scan-info">
            {{
              o.engine.lastScanAt
                ? t("engine.lastScan", { at: fmtDateTime(lang, o.engine.lastScanAt) })
                : t("engine.neverScanned")
            }}
          </p>
          <p v-if="scanResult?._tag === 'Done'" class="notice ok" role="status" data-testid="scan-done">
            {{
              scanResult.codes.length === 0
                ? t("engine.scan.done.none")
                : t("engine.scan.done.found", { codes: scanResult.codes.join(", ") })
            }}
          </p>
          <p
            v-else-if="scanResult?._tag === 'NeedsConnection'"
            class="notice"
            role="status"
            data-testid="scan-needs-connection"
          >
            {{ t("engine.scan.needsConnection") }}
            <button class="link" type="button" @click="go({ name: 'connect' })">{{ t("action.connect") }}</button>
          </p>
          <p v-else-if="scanResult?._tag === 'Failed'" class="notice" role="alert">{{ t("engine.scan.failed") }}</p>
        </section>

        <article
          v-for="c in codes"
          :key="`${c.code}-${c.kind}`"
          class="card code"
          :class="`sev-border-${c.severity}`"
          data-testid="dtc"
        >
          <header class="code-head">
            <b class="code-id">{{ c.code }}</b>
            <SeverityBadge :severity="c.severity" />
          </header>
          <h3 class="code-title">{{ c.title }}</h3>
          <p class="muted">{{ t(codeKindKey(c.kind)) }}</p>
          <div class="can-drive" :class="`sev-${c.severity}`" data-testid="can-drive">
            <span class="can-drive-label">{{ t("engine.canDrive") }}</span>
            {{ c.canDrive }}
          </div>
          <h4>{{ t("engine.meaning") }}</h4>
          <p>{{ c.meaning }}</p>
          <h4>{{ t("engine.causes") }}</h4>
          <ul class="list">
            <li v-for="x in c.commonCauses" :key="x">{{ x }}</li>
          </ul>
          <h4>{{ t("engine.whatToDo") }}</h4>
          <p>{{ c.whatToDo }}</p>
          <p class="muted seen">
            {{ t("engine.firstSeen", { at: fmtDateTime(lang, c.firstSeenAt) }) }} ·
            {{ t("engine.lastSeen", { at: fmtDateTime(lang, c.lastSeenAt) }) }}
          </p>
          <p v-if="c.source === 'generic'" class="muted">{{ t("engine.generic") }}</p>
        </article>

        <section v-if="history.data.value?.length" class="block" data-testid="engine-history">
          <h3 class="section">{{ t("engine.history") }}</h3>
          <div v-for="a in history.data.value" :key="a.id" class="card hist">
            <b>{{ a.title }}</b>
            <p class="muted">
              {{ fmtDateTime(lang, a.createdAt) }} – {{ fmtDateTime(lang, a.resolvedAt ?? a.createdAt) }}
            </p>
            <p>{{ a.details }}</p>
          </div>
        </section>
        <p class="muted fine">{{ t("engine.disclaimer") }}</p>
      </template>
    </AsyncState>
  </div>
</template>
