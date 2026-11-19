<script setup lang="ts">
export type CardTone = "ok" | "watch" | "soon" | "urgent" | "muted"

defineProps<{ title: string; tone?: CardTone; testid?: string; wide?: boolean }>()
defineEmits<{ open: [] }>()
</script>

<template>
  <button class="icard" :class="[`tone-${tone ?? 'muted'}`, { wide }]" type="button" :data-testid="testid" @click="$emit('open')">
    <span class="icard-head">
      <span class="icard-title"><slot name="icon" />{{ title }}</span>
      <span class="icard-chev" aria-hidden="true">›</span>
    </span>
    <slot />
  </button>
</template>
