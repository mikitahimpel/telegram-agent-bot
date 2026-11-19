import type { Lang } from "../i18n/format.ts"
import { makeT } from "../i18n/index.ts"
import { describeStatus, type StatusView } from "./describe-status.ts"
import type { ConnectionVm, RecorderVm, SyncGlobalVm, TripVm } from "./types.ts"

export interface HomeInput {
  conn: ConnectionVm
  rec: RecorderVm
  sync: SyncGlobalVm
  trips: TripVm[]
}

const pendingTrips = (trips: TripVm[]) =>
  trips.filter((t) => ["Queued", "Uploading", "Waiting", "Verifying"].includes(t.sync._tag))

/** Picks the single most important thing to tell the user on the Home card. */
export const describeHome = (i: HomeInput, lang: Lang, now: number = Date.now()): StatusView => {
  const t = makeT(lang)
  if (i.rec._tag !== "Idle") {
    const rec = describeStatus({ kind: "recorder", state: i.rec }, lang, now)
    if (i.rec._tag === "Recording" && i.conn._tag === "Lost") return describeStatus({ kind: "connection", state: i.conn }, lang, now)
    return rec
  }
  const attention = i.trips.find((x) => x.sync._tag === "Incomplete")
  if (attention) {
    const v = describeStatus({ kind: "trip", state: attention.sync, localCopyLost: !attention.localCopy }, lang, now)
    return { ...v, action: { id: "openTrip", label: t("action.openTrip") } }
  }
  const pending = pendingTrips(i.trips)
  if (pending.length > 0 && i.sync._tag !== "Idle" && i.sync._tag !== "Syncing") {
    const v = describeStatus({ kind: "trip", state: pending[0]!.sync, sync: i.sync }, lang, now)
    if (v.title !== describeStatus({ kind: "trip", state: pending[0]!.sync }, lang, now).title) {
      return { ...v, title: v.title, action: v.action ?? { id: "openTrips", label: t("action.openTrips") } }
    }
  }
  if ((i.sync._tag === "NeedsReauth" && i.sync.reason !== "not_paired") || i.sync._tag === "Blocked") return describeStatus({ kind: "sync", state: i.sync }, lang, now)
  if (pending.length > 0) {
    if (i.sync._tag === "Offline") return describeStatus({ kind: "sync", state: i.sync }, lang, now)
    let sent = 0
    let total = 0
    for (const p of pending) {
      total += p.chunks.length
      sent += p.chunks.filter((c) => c.state === "confirmed" || c.state === "sent").length
    }
    const waiting = pending.some((p) => p.sync._tag === "Waiting")
    return {
      tone: waiting ? "warn" : "progress",
      icon: "☁️",
      title: t("home.pending.title", { sent, total }),
      text: t("home.pending.text", { trips: pending.length }),
      action: { id: "openTrips", label: t("action.openTrips") }
    }
  }
  if (i.conn._tag === "Failed" || i.conn._tag === "Lost") return describeStatus({ kind: "connection", state: i.conn }, lang, now)
  if (i.conn._tag === "Ready") return { tone: "ok", icon: "✅", title: t("home.ready.title"), text: t("home.ready.text"), action: { id: "start", label: t("action.start") } }
  if (i.conn._tag !== "Idle") return describeStatus({ kind: "connection", state: i.conn }, lang, now)
  if (i.trips.length > 0 && i.trips.every((x) => x.sync._tag === "Confirmed" || x.sync._tag === "CloudOnly"))
    return { tone: "ok", icon: "✅", title: t("home.allDone.title"), text: t("home.allDone.text"), action: { id: "connect", label: t("action.connect") } }
  return describeStatus({ kind: "connection", state: i.conn }, lang, now)
}
