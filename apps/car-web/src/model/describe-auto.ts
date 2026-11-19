import type { Lang } from "../i18n/format.ts"
import { fmtClock } from "../i18n/format.ts"
import { makeT, type MessageKey } from "../i18n/index.ts"
import type { AutoVm, Tone } from "./types.ts"

export type AutoActionId = "chooseAdapter" | "connectManually" | "openTrip" | "enable"

export type AutoView = {
  tone: Tone
  icon: string
  title: string
  text: string
  action?: { id: AutoActionId; label: string }
}

export const describeAuto = (s: AutoVm, lang: Lang): AutoView | null => {
  const t = makeT(lang)
  const view = (tone: Tone, icon: string, title: MessageKey, text: MessageKey, params: Record<string, string | number> = {}, action?: { id: AutoActionId; label: MessageKey }): AutoView => ({
    tone,
    icon,
    title: t(title, params),
    text: t(text, params),
    ...(action ? { action: { id: action.id, label: t(action.label) } } : {})
  })
  switch (s._tag) {
    case "Off":
      return null
    case "NeedsTap": {
      if (s.reason === "unsupported") return view("warn", "📵", "auto.needsTap.unsupported.title", "auto.needsTap.unsupported.text", {}, { id: "connectManually", label: "auto.manual" })
      const key = s.reason === "forgotten" ? "forgotten" : s.reason === "gesture_required" ? "gesture_required" : s.reason === "permission_denied" ? "permission_denied" : "first_use"
      return view(s.reason === "permission_denied" ? "error" : "info", "🔌", `auto.needsTap.${key}.title`, `auto.needsTap.${key}.text`, {}, { id: "chooseAdapter", label: "auto.chooseAdapter" })
    }
    case "Reconnecting":
      return view("progress", "🔎", "auto.reconnecting.title", "auto.reconnecting.text")
    case "AdapterNotFound":
      return view("warn", "🔎", "auto.notFound.title", "auto.notFound.text", {}, { id: "chooseAdapter", label: "auto.chooseAdapter" })
    case "Connecting":
      return view("progress", "🔗", "auto.connecting.title", "auto.connecting.text", { step: s.step, total: s.total })
    case "Unavailable":
      return view("error", "📵", "auto.unavailable.title", "auto.unavailable.text", {}, { id: "connectManually", label: "auto.manual" })
    case "EcuNotResponding":
      return view("warn", "🔑", "auto.ecu.title", "auto.ecu.text")
    case "WaitingForEngine":
      return view("ok", "✅", "auto.waiting.title", "auto.waiting.text")
    case "Recording":
      return s.linkLostSince !== null
        ? view("warn", "⚠️", "auto.recording.lost.title", "auto.recording.lost.text")
        : { ...view("ok", "🔴", "auto.recording.title", "auto.recording.text", { name: s.adapterName }), text: `${t("auto.recording.text", { name: s.adapterName })} ${fmtClock(Date.now() - s.startedAt)}` }
    case "AutoStopped":
      return view("ok", "✅", "auto.stopped.title", "auto.stopped.text", {}, { id: "openTrip", label: "auto.stopped.open" })
  }
}
