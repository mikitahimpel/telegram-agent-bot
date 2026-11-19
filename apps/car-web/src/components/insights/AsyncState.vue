<script setup lang="ts">
import type { InsightsErrorCode } from "../../services/insights-api.ts"
import { useApp } from "../../app-context.ts"

defineProps<{ loading: boolean; error: InsightsErrorCode | null; hasData: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { t, backend, perform } = useApp()
</script>

<template>
  <div
    v-if="!hasData && loading"
    class="skeleton"
    role="status"
    :aria-label="t('common.loading')"
    data-testid="loading"
  >
    <div class="sk sk-title" />
    <div class="sk" />
    <div class="sk sk-short" />
  </div>
  <section v-else-if="error === 'not_paired'" class="card empty-state" data-testid="not-paired">
    <h2>{{ t("insights.notPaired.title") }}</h2>
    <p>{{ t("insights.notPaired.text") }}</p>
    <button
      class="btn btn-primary"
      type="button"
      data-testid="see-example"
      @click="
        backend.insightsDemo.value = true;
        emit('retry')
      "
    >
      {{ t("insights.notPaired.example") }}
    </button>
    <button class="btn" type="button" @click="perform('howToPair')">{{ t("action.howToPair") }}</button>
  </section>
  <section v-else-if="error && !hasData" class="card empty-state" role="alert" data-testid="load-error">
    <h2>{{ t(`insights.error.${error}.title`) }}</h2>
    <p>{{ t(`insights.error.${error}.text`) }}</p>
    <button class="btn btn-primary" type="button" @click="emit('retry')">{{ t("common.retry") }}</button>
  </section>
  <slot v-else />
</template>
