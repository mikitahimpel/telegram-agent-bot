<script setup lang="ts">
import Icon, { type IconName } from "../Icon.vue"

export type CardTone = "ok" | "watch" | "soon" | "urgent" | "muted"

defineProps<{ title: string; tone?: CardTone; testid?: string; wide?: boolean; icon?: IconName }>()
defineEmits<{ open: [] }>()
</script>

<template>
  <button
    class="icard"
    :class="[`tone-${tone ?? 'muted'}`, { wide }]"
    type="button"
    :data-testid="testid"
    @click="$emit('open')"
  >
    <span class="icard-head">
      <span class="icard-title"
        ><Icon v-if="icon" :name="icon" class="icard-icon" :size="20" /><slot name="icon" />{{ title }}</span
      >
      <span class="icard-pip" aria-hidden="true" />
      <Icon name="chevron-right" class="icard-chev" :size="20" />
    </span>
    <slot />
  </button>
</template>
