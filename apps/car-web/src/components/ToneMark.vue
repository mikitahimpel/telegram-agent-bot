<script setup lang="ts">
import type { Tone } from "../model/types.ts"
import Icon, { type IconName } from "./Icon.vue"

defineProps<{ tone: Tone }>()
const ICON: Record<Tone, IconName> = {
  ok: "check",
  info: "info",
  progress: "spinner",
  warn: "alert",
  error: "stop"
}
</script>

<template>
  <span class="tone-mark" :class="`mark-${tone}`" aria-hidden="true">
    <Icon :name="ICON[tone]" :size="22" />
  </span>
</template>
