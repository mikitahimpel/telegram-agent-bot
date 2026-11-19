<script setup lang="ts">
import type { Severity } from "@bot/car-format/insights"
import { useApp } from "../../app-context.ts"

defineProps<{ severity: Severity }>()
const { t } = useApp()
const glyph = { info: "i", watch: "!", soon: "!", urgent: "!!" } as const
</script>

<template>
  <span class="sev" :class="`sev-${severity}`" :data-severity="severity">
    <span class="sev-glyph" aria-hidden="true">{{ glyph[severity] }}</span>
    {{ t(`severity.${severity}`) }}
  </span>
</template>
