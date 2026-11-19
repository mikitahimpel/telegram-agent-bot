import { UserPrefs } from "@bot/core-contracts/user-prefs"
import { Clock, Effect } from "effect"
import { CarBackend, type CarBackendShape } from "@bot/car-store/backend"
import type { Alert, DtcExplanation, TripInsight } from "@bot/car-format/insights"
import { UserScheduler } from "@bot/bot-scheduler/user-scheduler"
import { ChatId, TgId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import type { JobHandler } from "@bot/core-contracts/scheduler"
import { Telegram, type InlineKeyboard } from "@bot/core-contracts/telegram"
import { escapeHtml, formatDuration, formatKm, formatStamp } from "./messages.ts"
import { notifyMessages } from "./notify-messages.ts"
import { CarWebUrl } from "./web-url.ts"

export type WeeklyView = Effect.Success<ReturnType<CarBackendShape["weekly"]>>

export const WEEKLY_KIND = "car_weekly"
export const weeklyJobId = (tgId: number): string => `${WEEKLY_KIND}:${tgId}`
export const LANG_META_KEY = "lang"

const DAY = 86_400_000

const WEEKLY_HOUR = 18

const localParts = (ms: number, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short"
  }).formatToParts(ms)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")),
    min: Number(get("minute")),
    s: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  }
}

const offsetMs = (ms: number, tz: string): number => {
  const p = localParts(ms, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000
}

const localToInstant = (y: number, m: number, d: number, h: number, tz: string): number => {
  const guess = Date.UTC(y, m - 1, d, h)
  const first = guess - offsetMs(guess, tz)
  return guess - offsetMs(first, tz)
}

const safeTz = (tz: string | undefined): string => {
  if (tz === undefined) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return "UTC"
  }
}

export const nextWeeklyAt = (now: number, timeZone?: string): number => {
  const tz = safeTz(timeZone)
  const today = localParts(now, tz)
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i))
    if (day.getUTCDay() !== 0) continue
    const at = localToInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), WEEKLY_HOUR, tz)
    if (at > now) return at
  }
  return now + 7 * DAY
}

const userTimeZone = (tgId: number) =>
  Effect.gen(function*() {
    const prefs = yield* Effect.serviceOption(UserPrefs)
    if (prefs._tag === "None") return undefined
    return yield* prefs.value.timeZone(TgId.make(tgId)).pipe(Effect.catch(() => Effect.succeed(undefined)))
  })

const withHash = (webUrl: string, hash: string): string => `${webUrl}#${hash}`

const button = (webUrl: string, text: string, hash: string): InlineKeyboard =>
  webUrl === "" ? [] : [[{ text, url: withHash(webUrl, hash) }]]

const num1 = (v: number, d = 1) => v.toFixed(d)

export type Rendered = { readonly html: string; readonly keyboard: InlineKeyboard }

export const tripSummary = (insight: TripInsight, lang: Lang, webUrl: string): Rendered => {
  const m = notifyMessages[lang]
  const lines: Array<string> = [m.tripHeader(formatStamp(insight.startedAt), formatDuration(insight.durationS, lang), formatKm(insight.distanceKm ?? undefined, lang))]
  if (insight.avgSpeedKmh !== null && insight.maxSpeedKmh !== null) lines.push(m.speed(num1(insight.avgSpeedKmh, 0), num1(insight.maxSpeedKmh, 0)))
  if (insight.fuelPer100Km !== null) {
    const delta = insight.comparedToUsual.fuelPer100KmDeltaPct
    const usual = delta === null ? null : insight.fuelPer100Km / (1 + delta / 100)
    const unit = lang === "ru" ? "л/100 км" : "L/100 km"
    lines.push(m.fuel(num1(insight.fuelPer100Km), insight.fuelIsEstimate) + (delta === null || usual === null ? "" : m.fuelUsual(`${num1(usual)} ${unit}`, delta)))
  }
  const notable: Array<string> = []
  const hard = insight.hardAccelerations + insight.hardBrakings
  if (hard >= 3) notable.push(m.hardEvents(hard))
  if (insight.maxCoolantC !== null && insight.maxCoolantC >= 100) notable.push(m.hot(Math.round(insight.maxCoolantC)))
  if (insight.durationS > 0 && insight.idleS / insight.durationS >= 0.3) notable.push(m.idling(Math.round((insight.idleS / insight.durationS) * 100)))
  if (notable.length > 0) lines.push(`${m.notableHeader} ${notable.join("; ")}.`)
  return { html: lines.join("\n"), keyboard: button(webUrl, m.openTrip, `trip=${insight.tripId}`) }
}

const alertHash = (a: Alert): { readonly hash: string; readonly label: "openEngine" | "openBattery" | "openStats" | "openOverview" } => {
  switch (a.kind) {
    case "check_engine":
    case "overheating":
    case "slow_warmup":
      return { hash: "engine", label: "openEngine" }
    case "battery_weak":
    case "charging_problem":
      return { hash: "battery", label: "openBattery" }
    case "fuel_consumption_up":
      return { hash: "stats", label: "openStats" }
    default:
      return { hash: "overview", label: "openOverview" }
  }
}

export const alertMessage = (a: Alert, lang: Lang, webUrl: string): Rendered => {
  const m = notifyMessages[lang]
  const target = alertHash(a)
  return {
    html: m.alertBody(m.severity(a.severity), escapeHtml(a.title), escapeHtml(a.details), escapeHtml(a.whatToDo)),
    keyboard: button(webUrl, m[target.label], target.hash)
  }
}

const MAX_CODE_BLOCKS = 3

export const codesMessage = (codes: ReadonlyArray<DtcExplanation>, lang: Lang, webUrl: string): Rendered => {
  const m = notifyMessages[lang]
  const worst = codes.reduce<DtcExplanation["severity"]>((s, c) => (["info", "watch", "soon", "urgent"].indexOf(c.severity) > ["info", "watch", "soon", "urgent"].indexOf(s) ? c.severity : s), "info")
  const blocks = codes
    .slice(0, MAX_CODE_BLOCKS)
    .map((c) => m.codeBlock(c.code, escapeHtml(c.title), escapeHtml(c.meaning), escapeHtml(c.canDrive), escapeHtml(c.whatToDo)))
  if (codes.length > MAX_CODE_BLOCKS) blocks.push(m.moreCodes(codes.length - MAX_CODE_BLOCKS))
  return {
    html: `${m.severity(worst)}\n<b>${m.newCodes(codes.length)}</b>\n\n${blocks.join("\n\n")}`,
    keyboard: button(webUrl, m.openEngine, "engine")
  }
}

export const sendTo = (tgId: number, r: Rendered) =>
  Effect.gen(function*() {
    const tg = yield* Telegram
    yield* tg.sendMessage({ chatId: ChatId.make(tgId) }, r.html, r.keyboard.length === 0 ? {} : { keyboard: r.keyboard })
  })

export const notifyPending = (tgId: number, lang: Lang, webUrl: string) =>
  Effect.gen(function*() {
    const backend = yield* CarBackend
    yield* backend.setMeta(tgId, LANG_META_KEY, lang)
    const pending = yield* backend.pending(tgId, lang)
    if (pending.alerts.length === 0 && pending.codes.length === 0) return 0
    let sent = 0
    const sentAlerts: Array<string> = []
    const sentCodes: Array<{ readonly code: string; readonly kind: DtcExplanation["kind"] }> = []
    if (pending.codes.length > 0) {
      const ok = yield* sendTo(tgId, codesMessage(pending.codes, lang, webUrl)).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
      if (ok) {
        sent++
        sentCodes.push(...pending.codes.map((c) => ({ code: c.code, kind: c.kind })))
        sentAlerts.push(...pending.alerts.filter((a) => a.kind === "check_engine").map((a) => a.id))
      }
    }
    for (const a of pending.alerts) {
      if (a.kind === "check_engine" && pending.codes.length > 0) continue
      const ok = yield* sendTo(tgId, alertMessage(a, lang, webUrl)).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
      if (ok) {
        sent++
        sentAlerts.push(a.id)
      }
    }
    yield* backend.markNotified(tgId, sentAlerts, sentCodes)
    return sent
  })

export const weeklyMessage = (stats: WeeklyView, lang: Lang, webUrl: string): Rendered => {
  const m = notifyMessages[lang]
  const lines: Array<string> = [m.weeklyHeader]
  const unit = lang === "ru" ? "л/100 км" : "L/100 km"
  if (stats.trips === 0) lines.push(m.weeklyNoTrips)
  else {
    lines.push(m.weeklyTrips(stats.trips, stats.previousTrips, formatKm(stats.distanceKm, lang), formatKm(stats.previousDistanceKm, lang)))
    if (stats.fuelPer100Km !== null) {
      lines.push(m.weeklyFuel(num1(stats.fuelPer100Km), stats.previousFuelPer100Km === null ? m.none : `${num1(stats.previousFuelPer100Km)} ${unit}`))
    }
    if (stats.idleShare !== null) lines.push(m.weeklyIdle(Math.round(stats.idleShare * 100)))
    if (stats.hardEvents > 0) lines.push(m.weeklyHard(stats.hardEvents))
    if (stats.maxCoolantC !== null) lines.push(m.weeklyHot(Math.round(stats.maxCoolantC)))
  }
  lines.push(m.weeklyBattery(stats.batteryStatus, stats.lastRestingV === null ? "" : num1(stats.lastRestingV, 2)))
  lines.push(m.weeklyCodes(stats.activeCodes))
  lines.push(stats.openAlerts.length === 0 ? m.weeklyNone : `${m.weeklyAlerts}\n${stats.openAlerts.map((a) => `- ${escapeHtml(a.title)}`).join("\n")}`)
  return { html: lines.join("\n"), keyboard: button(webUrl, m.openOverview, "overview") }
}

export const ensureWeekly = (tgId: number) =>
  Effect.gen(function*() {
    const scheduler = yield* Effect.serviceOption(UserScheduler)
    if (scheduler._tag === "None") return
    const s = scheduler.value.forUser(TgId.make(tgId))
    const id = weeklyJobId(tgId)
    if ((yield* s.get(id)) !== undefined) return
    const now = yield* Clock.currentTimeMillis
    const tz = yield* userTimeZone(tgId)
    yield* s.schedule({ id, kind: WEEKLY_KIND, at: nextWeeklyAt(now, tz), payload: "" })
  }).pipe(Effect.catch(() => Effect.void))

export const weeklyJob: JobHandler<Telegram | CarBackend | CarWebUrl> = {
  kind: WEEKLY_KIND,
  run: (_job, ctx) =>
    Effect.gen(function*() {
      const backend = yield* CarBackend
      const webUrl = yield* CarWebUrl
      const stored = yield* backend.getMeta(ctx.tgId, LANG_META_KEY)
      const lang: Lang = stored === "ru" ? "ru" : "en"
      const stats = yield* backend.weekly(ctx.tgId, lang)
      yield* sendTo(ctx.tgId, weeklyMessage(stats, lang, webUrl)).pipe(Effect.ignore)
      const scheduler = yield* Effect.serviceOption(UserScheduler)
      if (scheduler._tag === "Some") {
        const tz = yield* userTimeZone(ctx.tgId)
        yield* scheduler.value
          .forUser(ctx.tgId)
          .schedule({ id: weeklyJobId(ctx.tgId), kind: WEEKLY_KIND, at: nextWeeklyAt(ctx.now, tz), payload: "" })
      }
    })
}
