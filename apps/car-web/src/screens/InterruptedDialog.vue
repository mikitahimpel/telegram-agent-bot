<script setup lang="ts">
import { useApp } from "../app-context.ts"
import { fmtTime } from "../i18n/format.ts"

const { backend, t, lang, go } = useApp()
const resume = async () => {
  await backend.resumeInterrupted()
  go({ name: "connect" })
}
</script>

<template>
  <div v-if="backend.interrupted.value" class="modal" role="dialog" aria-modal="true" data-testid="interrupted">
    <div class="card">
      <h2>{{ t("interrupted.title") }}</h2>
      <p>{{ t("interrupted.text", { time: fmtTime(lang, backend.interrupted.value.interruptedAt), points: backend.interrupted.value.points }) }}</p>
      <button class="btn btn-primary" type="button" @click="resume">{{ t("interrupted.continue") }}</button>
      <button class="btn" type="button" @click="backend.finishInterrupted()">{{ t("interrupted.finish") }}</button>
    </div>
  </div>
</template>
