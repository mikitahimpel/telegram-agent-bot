import { computed, inject, ref, watch, type ComputedRef, type InjectionKey, type Ref } from "vue"
import { makeT, type Lang, type TFn } from "./i18n/index.ts"
import type { ActionId, SimScenario, TransportKind } from "./model/types.ts"
import type { CarBackend } from "./services/backend.ts"
import { buildChromeIntentUrl } from "./services/env.ts"

export type Route =
  | { name: "home" }
  | { name: "connect"; preset?: TransportKind }
  | { name: "recording" }
  | { name: "trips" }
  | { name: "trip"; tripId: string }
  | { name: "settings" }
  | { name: "pair" }
  | { name: "overview" }
  | { name: "engine" }
  | { name: "battery" }
  | { name: "stats" }
  | { name: "alerts" }
  | { name: "onboarding" }

export const parseRouteHash = (hash: string): Route | null => {
  const h = hash.replace(/^#/, "")
  if (h === "") return null
  const trip = /^trip=([^&]+)/.exec(h)
  if (trip?.[1]) return { name: "trip", tripId: decodeURIComponent(trip[1]) }
  switch (h.split("&")[0]) {
    case "overview":
    case "engine":
    case "battery":
    case "stats":
    case "alerts":
    case "onboarding":
      return { name: h.split("&")[0] as "overview" }
    default:
      return null
  }
}

export const insightRoutes: ReadonlyArray<Route["name"]> = ["overview", "engine", "battery", "stats", "alerts", "trip", "onboarding"]

export type AppContext = {
  backend: CarBackend
  lang: Ref<Lang>
  t: ComputedRef<TFn>
  now: Ref<number>
  route: Ref<Route>
  go(r: Route): void
  back(): void
  canGoBack: ComputedRef<boolean>
  hashRouted: boolean
  setLang(l: Lang): void
  perform(id: ActionId, arg?: { tripId?: string; scenario?: SimScenario }): Promise<void>
  localMode: Ref<boolean>
  dismissed: Ref<string[]>
  installPrompt: Ref<{ prompt(): Promise<void> } | null>
}

export const AppKey: InjectionKey<AppContext> = Symbol("app")

export const useApp = (): AppContext => {
  const c = inject(AppKey)
  if (!c) throw new Error("AppContext not provided")
  return c
}

export const createAppContext = (opts: {
  backend: CarBackend
  lang: Lang
  tickMs?: number
  onSetLang?: (l: Lang) => void
}): AppContext => {
  const { backend } = opts
  const lang = ref<Lang>(opts.lang)
  const t = computed(() => makeT(lang.value))
  const now = ref(Date.now())
  if (opts.tickMs !== 0) setInterval(() => (now.value = Date.now()), opts.tickMs ?? 1000)
  const route = ref<Route>(parseRouteHash(typeof location === "undefined" ? "" : location.hash) ?? { name: "home" })
  const hashRouted = route.value.name !== "home"
  const stack: Route[] = []
  const LOCAL_KEY = "car-local-mode"
  const stored = (): boolean => {
    try {
      return localStorage.getItem(LOCAL_KEY) === "1"
    } catch {
      return false
    }
  }
  const localMode = ref(stored())
  watch(localMode, (on) => {
    try {
      if (on) localStorage.setItem(LOCAL_KEY, "1")
      else localStorage.removeItem(LOCAL_KEY)
    } catch {
    }
  })
  const DEMO_KEY = "car-demo-insights"
  try {
    if (localStorage.getItem(DEMO_KEY) === "1") backend.insightsDemo.value = true
  } catch {
  }
  watch(backend.insightsDemo, (on) => {
    try {
      if (on) localStorage.setItem(DEMO_KEY, "1")
      else localStorage.removeItem(DEMO_KEY)
    } catch {
    }
  })
  const dismissed = ref<string[]>([])
  const installPrompt = ref<{ prompt(): Promise<void> } | null>(null)
  const depth = ref(0)

  const go = (r: Route) => {
    if (JSON.stringify(r) === JSON.stringify(route.value)) return
    stack.push(route.value)
    depth.value = stack.length
    route.value = r
  }
  const back = () => {
    route.value = stack.pop() ?? { name: "home" }
    depth.value = stack.length
  }
  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", () => {
      const r = parseRouteHash(location.hash)
      if (r) go(r)
    })
  }
  const ctx: AppContext = {
    backend,
    lang,
    t,
    now,
    route,
    go,
    back,
    canGoBack: computed(() => depth.value > 0),
    hashRouted,
    setLang(l) {
      lang.value = l
      opts.onSetLang?.(l)
    },
    installPrompt,
    localMode,
    dismissed,
    async perform(id, arg) {
      switch (id) {
        case "connect":
        case "retry":
          localMode.value = true
          return go({ name: "connect" })
        case "tryDemo":
          localMode.value = true
          backend.insightsDemo.value = true
          return go({ name: "connect", preset: "simulator" })
        case "start":
          localMode.value = true
          await backend.startRecording()
          return go({ name: "recording" })
        case "stop":
          await backend.stopRecording()
          return go({ name: "home" })
        case "retryNow":
          if (arg?.tripId) await backend.retryNow(arg.tripId)
          return
        case "exportFile":
          if (arg?.tripId) await backend.exportTrip(arg.tripId)
          return
        case "openTrip":
          return go(arg?.tripId ? { name: "trip", tripId: arg.tripId } : { name: "trips" })
        case "openTrips":
          return go({ name: "trips" })
        case "openSettings":
          return go({ name: "settings" })
        case "requestPersistence":
          await backend.requestPersistence()
          return
        case "howToPair":
          return go({ name: "pair" })
        case "openInChrome":
          window.location.href = buildChromeIntentUrl(window.location)
          return
        case "install":
          await installPrompt.value?.prompt()
          return
        case "revokeDevice":
        case "deleteLocal":
          return
      }
    }
  }
  return ctx
}
