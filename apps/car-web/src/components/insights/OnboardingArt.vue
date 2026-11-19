<script setup lang="ts">
export type ArtId = "adapter" | "buy" | "port" | "connect" | "home" | "tips"
defineProps<{ id: ArtId }>()
</script>

<template>
  <svg
    class="art"
    viewBox="0 0 240 150"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="id === 'adapter'">
      <rect x="64" y="42" width="112" height="56" rx="12" class="fill-soft" />
      <rect x="84" y="98" width="72" height="22" rx="4" />
      <path d="M96 120v10M108 120v10M120 120v10M132 120v10M144 120v10" />
      <circle cx="92" cy="62" r="5" class="accent" />
      <path d="M112 62h40M112 78h28" />
    </template>
    <template v-else-if="id === 'buy'">
      <rect x="50" y="34" width="100" height="52" rx="12" class="fill-soft" />
      <path d="M72 60l10 10 22-22" class="accent" />
      <path d="M176 44a28 28 0 0 1 0 40M192 34a44 44 0 0 1 0 60" class="accent" />
      <path d="M168 64h-10" />
      <path d="M70 108h60M70 124h40" />
    </template>
    <template v-else-if="id === 'port'">
      <path d="M20 24h200M20 24c0 40 30 70 70 70h60c40 0 70-30 70-70" class="fill-soft" />
      <circle cx="120" cy="58" r="26" />
      <path d="M96 58h48M120 32v52" />
      <path d="M96 118h48l-6 20h-36z" class="accent" />
      <path d="M120 100v14" class="accent" />
    </template>
    <template v-else-if="id === 'connect'">
      <rect x="22" y="30" width="64" height="100" rx="12" class="fill-soft" />
      <path d="M44 42h20" />
      <path d="M40 80l10 10 20-24" class="accent" />
      <path d="M100 80h26M134 80h6" stroke-dasharray="2 8" />
      <path d="M156 60l24 20-24 20 12-20z" class="accent" />
      <rect x="196" y="66" width="28" height="28" rx="6" />
    </template>
    <template v-else-if="id === 'home'">
      <rect x="62" y="14" width="116" height="124" rx="14" class="fill-soft" />
      <rect x="82" y="34" width="32" height="32" rx="8" />
      <rect x="126" y="34" width="32" height="32" rx="8" />
      <rect x="82" y="78" width="32" height="32" rx="8" class="accent" />
      <path d="M92 94h12M98 88v12" class="accent" />
      <path d="M126 94h32" />
    </template>
    <template v-else>
      <rect x="86" y="18" width="68" height="108" rx="12" class="fill-soft" />
      <path d="M108 30h24" />
      <path d="M126 58l-14 22h16l-12 22" class="accent" />
      <path d="M40 132h160" />
      <path d="M60 132v-22M180 132v-22" />
      <path d="M60 110h22M158 110h22" />
    </template>
  </svg>
</template>
