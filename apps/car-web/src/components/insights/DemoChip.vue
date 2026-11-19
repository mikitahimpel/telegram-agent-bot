<script setup lang="ts">
import { useApp } from "../../app-context.ts"

const { backend, t } = useApp()
</script>

<template>
  <p v-if="backend.insightsDemo.value" class="demo-chip" data-testid="demo-chip">{{ t("insights.demo") }}</p>
</template>
