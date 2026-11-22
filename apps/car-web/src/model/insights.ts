import type { Alert, CarOverview, DtcExplanation, PeriodStats, Severity } from "@bot/car-format/insights"
import type { Lang } from "../i18n/format.ts"

export type Verdict = "ok" | "nodata" | Severity

const RANK: Record<Severity, number> = { info: 0, watch: 1, soon: 2, urgent: 3 }

export const worstSeverity = (items: ReadonlyArray<{ severity: Severity }>): Severity | null =>
  items.reduce<Severity | null>((w, i) => (w === null || RANK[i.severity] > RANK[w] ? i.severity : w), null)

export const bySeverityDesc = <A extends { severity: Severity }>(items: ReadonlyArray<A>): A[] =>
  [...items].sort((a, b) => RANK[b.severity] - RANK[a.severity])

export const activeAlerts = (alerts: ReadonlyArray<Alert>): Alert[] =>
  bySeverityDesc(alerts.filter((a) => a.resolvedAt === null))

export const hasNoInsights = (o: CarOverview): boolean =>
  o.engine.lastScanAt === null && o.battery.status === "unknown" && o.totals.trips === 0

export const verdictOf = (o: CarOverview): Verdict => {
  if (hasNoInsights(o)) return "nodata"
  const sev = worstSeverity([...o.engine.activeCodes, ...activeAlerts(o.alerts)])
  const battery: Severity | null = o.battery.status === "weak" ? "soon" : o.battery.status === "watch" ? "watch" : null
  const all = [sev, battery].filter((s): s is Severity => s !== null)
  const worst = worstSeverity(all.map((severity) => ({ severity })))
  return worst === null || worst === "info" ? "ok" : worst
}

export type CardTone = "ok" | "watch" | "soon" | "urgent" | "muted"

export const engineTone = (o: CarOverview): CardTone => {
  if (o.engine.lastScanAt === null) return "muted"
  const w = worstSeverity(o.engine.activeCodes)
  return w === null ? "ok" : w === "info" ? "watch" : w
}

export const batteryTone = (status: CarOverview["battery"]["status"]): CardTone =>
  status === "good" ? "ok" : status === "watch" ? "watch" : status === "weak" ? "soon" : "muted"

export type FuelSummary = { recent: number; usual: number | null; deltaPct: number | null; periodsUsed: number }

export const fuelSummary = (byWeek: ReadonlyArray<PeriodStats>): FuelSummary | null => {
  const withFuel = byWeek.filter((w) => w.fuelPer100Km !== null && w.distanceKm > 0)
  const recent = withFuel[withFuel.length - 1]
  if (!recent || recent.fuelPer100Km === null) return null
  const earlier = withFuel.slice(0, -1)
  const km = earlier.reduce((s, w) => s + w.distanceKm, 0)
  const usual = km > 0 ? earlier.reduce((s, w) => s + (w.fuelPer100Km ?? 0) * w.distanceKm, 0) / km : null
  return {
    recent: recent.fuelPer100Km,
    usual,
    deltaPct: usual === null ? null : ((recent.fuelPer100Km - usual) / usual) * 100,
    periodsUsed: earlier.length
  }
}

export const periodLabel = (p: string, kind: "week" | "month", lang: Lang): string => {
  if (kind === "week") {
    const w = /W(\d+)$/.exec(p)?.[1]
    return w ? String(Number(w)) : p
  }
  const m = /^(\d{4})-(\d{2})$/.exec(p)
  if (!m) return p
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  )
}

export const periodTitle = (p: string, kind: "week" | "month", lang: Lang): string => {
  if (kind === "week") {
    const m = /^(\d{4})-W(\d+)$/.exec(p)
    return m ? `${lang === "ru" ? "Неделя" : "Week"} ${Number(m[2])}, ${m[1]}` : p
  }
  const m = /^(\d{4})-(\d{2})$/.exec(p)
  if (!m) return p
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)))
}

export const codeKindKey = (k: DtcExplanation["kind"]) => `engine.kind.${k}` as const
