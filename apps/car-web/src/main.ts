import { createApp, watch } from "vue"
import App from "./App.vue"
import { AppKey, createAppContext } from "./app-context.ts"
import { initialLang } from "./services/env.ts"
import { runPairing } from "./services/pairing-flow.ts"
import { API_BASE, createBackend } from "./services/runtime.ts"
import "./styles.css"

const LANG_KEY = "car-lang"
const read = (): string | null => {
  try {
    return localStorage.getItem(LANG_KEY)
  } catch {
    return null
  }
}

const backend = createBackend()
const ctx = createAppContext({
  backend,
  lang: initialLang(navigator.language, read()),
  onSetLang: (l) => {
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
    }
  }
})

const pair = () =>
  runPairing(backend, {
    hash: location.hash,
    ua: navigator.userAgent,
    apiBase: API_BASE,
    stripHash: () => history.replaceState(null, "", location.pathname + location.search)
  })
void pair()

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault()
  ctx.installPrompt.value = { prompt: async () => void (await (e as Event & { prompt(): Promise<void> }).prompt()) }
})
window.addEventListener("online", () => (backend.online.value = true))
window.addEventListener("offline", () => (backend.online.value = false))
backend.online.value = navigator.onLine

watch(ctx.lang, (l) => (document.documentElement.lang = l), { immediate: true })

createApp(App, { retryPairing: () => void pair() })
  .provide(AppKey, ctx)
  .mount("#app")

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
}
