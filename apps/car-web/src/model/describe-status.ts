import { fmtDateTime, fmtClock, type Lang } from "../i18n/format.ts"
import { makeT, type MessageKey, type TFn } from "../i18n/index.ts"
import type {
  ActionId,
  Capabilities,
  ConnectionVm,
  ObdErrorCode,
  PairError,
  Platform,
  RecorderVm,
  SyncErrorCode,
  SyncGlobalVm,
  Tone,
  TripSyncVm
} from "./types.ts"

export interface StatusAction {
  id: ActionId
  label: string
}

export interface StatusView {
  tone: Tone
  icon: string
  title: string
  text: string
  summary?: string
  action?: StatusAction
  details?: string
}

export type StatusInput =
  | { kind: "connection"; state: ConnectionVm }
  | { kind: "error"; code: ObdErrorCode; step?: string; detail?: string; reason?: string }
  | { kind: "recorder"; state: RecorderVm }
  | { kind: "sync"; state: SyncGlobalVm }
  | { kind: "trip"; state: TripSyncVm; localCopyLost?: boolean; sync?: SyncGlobalVm }
  | { kind: "env"; caps: Pick<Capabilities, "ble" | "serial" | "secureContext">; platform: Platform; telegramWebview: boolean }
  | { kind: "storage"; level: "low" | "notPersistent"; usedPct?: number }
  | { kind: "clock"; offsetMs: number }
  | { kind: "pair"; state: "unpaired" | "localOnly" | "progress" | "done" | PairError }

export const fmtDuration = (t: TFn, ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return t("time.s", { n: s })
  const m = Math.round(s / 60)
  if (m < 60) return t("time.min", { n: m })
  return t("time.h", { n: Math.round(m / 6) / 10 })
}

const listParts = (seqs: number[]): string => {
  const sorted = [...seqs].sort((a, b) => a - b).map((n) => n + 1)
  const shown = sorted.slice(0, 6).join(", ")
  return sorted.length > 6 ? `${shown}…` : shown
}

const act = (t: TFn, id: ActionId): StatusAction => ({ id, label: t(`action.${id}` as MessageKey) })

const errorView = (t: TFn, code: ObdErrorCode, step: string | undefined, detail: string | undefined, reason?: string): StatusView => {
  if (code === "BluetoothUnavailable" && reason === "insecure_context")
    return { tone: "error", icon: "⛔", title: t("env.insecure.title"), text: t("env.insecure.text"), action: act(t, "tryDemo"), details: detail ?? `${code}:${reason}` }
  if (code === "BluetoothUnavailable" && reason === "unsupported")
    return { tone: "error", icon: "⛔", title: t("env.noble.title"), text: t("env.noble.text"), action: act(t, "tryDemo"), details: detail ?? `${code}:${reason}` }
  const tone: Tone = code === "CommandTimeout" || code === "CommandRejected" ? "warn" : "error"
  const actionId: ActionId =
    code === "BluetoothUnavailable" || code === "SerialUnavailable" ? "tryDemo" : "retry"
  return {
    tone,
    icon: tone === "warn" ? "⚠️" : "⛔",
    title: t(`err.${code}.title` as MessageKey),
    text: t(`err.${code}.text` as MessageKey, { step: step ?? "?", token: reason ?? "?" }),
    action: act(t, actionId),
    details: detail ?? `${code}${step ? ` (${step})` : ""}${reason ? ` [${reason}]` : ""}`
  }
}

const connectionView = (t: TFn, s: ConnectionVm, now: number): StatusView => {
  switch (s._tag) {
    case "Idle":
      return { tone: "info", icon: "🔌", title: t("conn.idle.title"), text: t("conn.idle.text"), action: act(t, "connect") }
    case "RequestingDevice":
      return { tone: "progress", icon: "🔎", title: t("conn.requesting.title"), text: t("conn.requesting.text") }
    case "Connecting":
      return { tone: "progress", icon: "🔗", title: t("conn.connecting.title"), text: t("conn.connecting.text") }
    case "InitializingAdapter":
      return {
        tone: "progress",
        icon: "⚙️",
        title: t("conn.init.title"),
        text: t("conn.init.text", { step: s.step, total: s.total, label: s.label })
      }
    case "WaitingForEcu":
      return { tone: "progress", icon: "🚗", title: t("conn.ecu.title"), text: t("conn.ecu.text") }
    case "Ready":
      return {
        tone: "ok",
        icon: "✅",
        title: t("conn.ready.title"),
        text: t("conn.ready.text", { sensors: s.sensors }),
        action: act(t, "start"),
        details: s.adapterName ? `${s.adapterName} · PIDs ${s.supportedPids.join(" ")}` : s.supportedPids.join(" ")
      }
    case "Lost":
      return {
        tone: "warn",
        icon: "📡",
        title: t("conn.lost.title", { ago: fmtDuration(t, now - s.since) }),
        text: t("conn.lost.text", { attempt: s.attempt, next: fmtDuration(t, Math.max(0, s.nextRetryAt - now)) })
      }
    case "Failed":
      return errorView(t, s.error.code, s.error.step, s.error.detail, s.error.reason)
  }
}

const recorderView = (t: TFn, lang: Lang, s: RecorderVm, now: number): StatusView => {
  switch (s._tag) {
    case "Idle":
      return { tone: "info", icon: "⏺", title: t("rec.idle.title"), text: t("rec.idle.text") }
    case "Recording":
      if (s.storageError)
        return { tone: "error", icon: "💾", title: t("rec.storage.title"), text: t("rec.storage.text"), action: act(t, "stop"), details: `storage: ${s.storageError}` }
      if (s.sourceEnded)
        return { tone: "warn", icon: "🔌", title: t("rec.sourceEnded.title"), text: t("rec.sourceEnded.text"), action: act(t, "stop") }
      if (s.gapOpen)
        return {
          tone: "warn",
          icon: "⏸",
          title: t("rec.gap.title"),
          text: t("rec.gap.text", { points: s.points }),
          action: act(t, "stop")
        }
      return {
        tone: "progress",
        icon: "🔴",
        title: t("rec.recording.title", { clock: fmtClock(now - s.startedAt) }),
        text: t("rec.recording.text", { points: s.points }),
        action: act(t, "stop"),
        details: `trip ${s.tripId} · chunks ${s.chunks} · lang ${lang}`
      }
    case "Finishing":
      return { tone: "progress", icon: "💾", title: t("rec.finishing.title"), text: t("rec.finishing.text") }
    case "Error":
      return {
        tone: "error",
        icon: "⛔",
        title: t("rec.error.title"),
        text: t("rec.error.text"),
        action: act(t, "retry"),
        details: s.message
      }
  }
}

const syncView = (t: TFn, s: SyncGlobalVm): StatusView => {
  switch (s._tag) {
    case "Idle":
      return { tone: "ok", icon: "✅", title: t("sync.idle.title"), text: t("sync.idle.text") }
    case "Syncing":
      return { tone: "progress", icon: "☁️", title: t("sync.syncing.title"), text: t("sync.syncing.text") }
    case "Offline":
      return { tone: "warn", icon: "📴", title: t("sync.offline.title"), text: t("sync.offline.text") }
    case "NeedsReauth":
      if (s.reason === "not_paired") return pairView(t, "unpaired")
      return {
        tone: "error",
        icon: "🔒",
        title: t("sync.revoked.title"),
        text: t("sync.revoked.text"),
        action: act(t, "howToPair")
      }
    case "Blocked":
      return {
        tone: "error",
        icon: "🚫",
        title: t(`sync.${s.code}.title`),
        text: t(`sync.${s.code}.text`),
        details: s.code
      }
    case "Paused":
      return { tone: "info", icon: "⏸", title: t("sync.paused.title"), text: t("sync.paused.text") }
  }
}

const blockerKey = (g: SyncGlobalVm | undefined): string | null => {
  if (!g) return null
  switch (g._tag) {
    case "NeedsReauth":
      return g.reason === "not_paired" ? "unpaired" : "revoked"
    case "Blocked":
      return g.code === "plugin_disabled" ? "plugin" : "forbidden"
    case "Offline":
      return "offline"
    case "Paused":
      return "paused"
    default:
      return null
  }
}

const tripView = (t: TFn, lang: Lang, s: TripSyncVm, now: number, localCopyLost: boolean, global?: SyncGlobalVm): StatusView => {
  const blocker = blockerKey(global)
  if (blocker && (s._tag === "Queued" || s._tag === "Uploading" || s._tag === "Waiting")) {
    const k = `trip.blocked.${blocker}`
    return {
      tone: blocker === "offline" || blocker === "paused" ? "warn" : "error",
      icon: blocker === "offline" ? "📴" : "🔒",
      title: t(`${k}.title` as MessageKey),
      text: t(`${k}.text` as MessageKey),
      summary: t(`${k}.summary` as MessageKey),
      ...(blocker === "unpaired" || blocker === "revoked" ? { action: { id: "howToPair" as ActionId, label: t("banner.connectLink") } } : {})
    }
  }
  const v = (k: string, p?: Record<string, string | number>): { title: string; text: string; summary: string } => ({
    title: t(`trip.${k}.title` as MessageKey, p),
    text: t(`trip.${k}.text` as MessageKey, p),
    summary: t(`trip.${k}.summary` as MessageKey, p)
  })
  switch (s._tag) {
    case "Recording":
      return { tone: "progress", icon: "🔴", ...v("recording") }
    case "Queued":
      return { tone: "info", icon: "🕓", ...v("queued") }
    case "Uploading":
      return { tone: "progress", icon: "⬆️", ...v("uploading", { sent: s.sent, total: s.total, confirmed: s.confirmed }) }
    case "Waiting": {
      const p = {
        sent: s.sent,
        total: s.total,
        waiting: s.total - s.sent,
        next: fmtDuration(t, Math.max(0, s.nextRetryAt - now)),
        reason: t(`trip.waiting.reason.${s.lastError}` as MessageKey)
      }
      return {
        tone: s.lastError === "unauthorized" ? "error" : "warn",
        icon: "⏳",
        ...v("waiting", p),
        action: act(t, "retryNow"),
        details: s.detail ?? s.lastError
      }
    }
    case "Verifying":
      return { tone: "progress", icon: "🔍", ...v("verifying") }
    case "Confirmed":
      return { tone: "ok", icon: "✅", ...v("confirmed", { when: fmtDateTime(lang, s.at) }) }
    case "CloudOnly":
      return { tone: "ok", icon: "☁️", ...v("cloudonly") }
    case "Incomplete": {
      const lostLocal = !s.localCopy || localCopyLost
      if (s.conflict.length > 0)
        return {
          tone: "error",
          icon: "⛔",
          ...v("conflict", { n: s.conflict.length, list: listParts(s.conflict) }),
          action: act(t, "exportFile"),
          details: `conflict: ${s.conflict.join(",")}`
        }
      const bad = [...s.missing, ...s.corrupt]
      if (lostLocal && bad.length > 0)
        return {
          tone: "error",
          icon: "⛔",
          ...v("lost", { list: listParts(bad) }),
          details: `missing: ${s.missing.join(",")} corrupt: ${s.corrupt.join(",")}`
        }
      if (s.corrupt.length > 0)
        return {
          tone: "error",
          icon: "⚠️",
          ...v("corrupt", { n: s.corrupt.length, list: listParts(s.corrupt) }),
          action: act(t, "retryNow"),
          details: `corrupt: ${s.corrupt.join(",")}`
        }
      return {
        tone: "warn",
        icon: "⚠️",
        ...v("missing", { n: s.missing.length, list: listParts(s.missing) }),
        action: act(t, "retryNow"),
        details: `missing: ${s.missing.join(",")}`
      }
    }
  }
}

const envView = (t: TFn, i: Extract<StatusInput, { kind: "env" }>): StatusView | null => {
  const { caps, platform, telegramWebview } = i
  const base = (k: string, action?: ActionId): StatusView => ({
    tone: "error",
    icon: "🚫",
    title: t(`env.${k}.title` as MessageKey),
    text: t(`env.${k}.text` as MessageKey),
    ...(action ? { action: act(t, action) } : {}),
    details: `ble=${caps.ble} serial=${caps.serial} secure=${caps.secureContext} platform=${platform} telegramWebview=${telegramWebview}`
  })
  if (!caps.secureContext) return base("insecure")
  if (caps.ble || caps.serial) return null
  if (platform === "ios") return base("chromeIos")
  if (telegramWebview) return base("telegramWebview", "openInChrome")
  if (platform === "android") return base("webview", "openInChrome")
  if (platform === "desktop") return base("chromeDesktop")
  return base("noble")
}

const pairView = (t: TFn, state: Extract<StatusInput, { kind: "pair" }>["state"]): StatusView => {
  switch (state) {
    case "unpaired":
      return { tone: "info", icon: "📲", title: t("pair.unpaired.title"), text: t("pair.unpaired.text") }
    case "localOnly":
      return { tone: "warn", icon: "📱", title: t("pair.local.title"), text: t("pair.local.text"), action: act(t, "howToPair") }
    case "progress":
      return { tone: "progress", icon: "🔗", title: t("pair.progress.title"), text: t("pair.progress.text") }
    case "done":
      return { tone: "ok", icon: "✅", title: t("pair.done.title"), text: t("pair.done.text") }
    case "invalid":
      return { tone: "error", icon: "⏱", title: t("pair.invalid.title"), text: t("pair.invalid.text"), action: act(t, "howToPair") }
    case "network":
      return { tone: "warn", icon: "📴", title: t("pair.network.title"), text: t("pair.network.text"), action: act(t, "retry") }
    case "blocked":
      return { tone: "error", icon: "🚫", title: t("sync.plugin_disabled.title"), text: t("sync.plugin_disabled.text") }
    case "unknown":
      return { tone: "error", icon: "⛔", title: t("pair.unknown.title"), text: t("pair.unknown.text"), action: act(t, "howToPair") }
  }
}

export function describeStatus(input: Exclude<StatusInput, { kind: "env" }>, lang: Lang, now?: number): StatusView
export function describeStatus(input: StatusInput, lang: Lang, now?: number): StatusView | null
export function describeStatus(input: StatusInput, lang: Lang, now: number = Date.now()): StatusView | null {
  const t = makeT(lang)
  switch (input.kind) {
    case "connection":
      return connectionView(t, input.state, now)
    case "error":
      return errorView(t, input.code, input.step, input.detail, input.reason)
    case "recorder":
      return recorderView(t, lang, input.state, now)
    case "sync":
      return syncView(t, input.state)
    case "trip":
      return tripView(t, lang, input.state, now, input.localCopyLost ?? false, input.sync)
    case "env":
      return envView(t, input)
    case "storage":
      return input.level === "low"
        ? {
            tone: "warn",
            icon: "💾",
            title: t("storage.low.title"),
            text: t("storage.low.text", { pct: Math.round(input.usedPct ?? 0) }),
            action: act(t, "openSettings")
          }
        : {
            tone: "warn",
            icon: "💾",
            title: t("storage.notPersistent.title"),
            text: t("storage.notPersistent.text"),
            action: act(t, "requestPersistence")
          }
    case "clock":
      return {
        tone: "warn",
        icon: "🕒",
        title: t("clock.title"),
        text: t("clock.text", { delta: fmtDuration(t, Math.abs(input.offsetMs)) })
      }
    case "pair":
      return pairView(t, input.state)
  }
}

export type { SyncErrorCode }
