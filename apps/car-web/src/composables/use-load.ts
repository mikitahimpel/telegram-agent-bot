import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue"
import { InsightsError, type InsightsErrorCode } from "../services/insights-api.ts"

export type Load<A> = {
  data: ShallowRef<A | null>
  error: Ref<InsightsErrorCode | null>
  loading: Ref<boolean>
  reload: () => Promise<void>
}

export const useLoad = <A>(fn: () => Promise<A>, deps: () => unknown = () => null): Load<A> => {
  const data = shallowRef<A | null>(null)
  const error = ref<InsightsErrorCode | null>(null)
  const loading = ref(true)
  let seq = 0
  let alive = true
  const reload = async () => {
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const v = await fn()
      if (alive && mine === seq) data.value = v
    } catch (e) {
      if (alive && mine === seq) error.value = e instanceof InsightsError ? e.code : "server"
    } finally {
      if (alive && mine === seq) loading.value = false
    }
  }
  watch(deps, () => void reload(), { immediate: true })
  onBeforeUnmount(() => (alive = false))
  return { data, error, loading, reload }
}
