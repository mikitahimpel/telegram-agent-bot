import type { AlertKind, Severity, TripInsight } from "@bot/car-format/insights"
import type { TripExtras } from "./insight.ts"
import type { CarSql } from "./sql.ts"
import { str } from "./sql.ts"

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, watch: 1, soon: 2, urgent: 3 }

export const maxSeverity = (a: Severity, b: Severity): Severity => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b)

export const THRESHOLDS = {
  restingWatchV: 12.4,
  restingWeakV: 12.2,
  restingOkV: 12.5,
  crankWeakV: 9.6,
  crankOkV: 9.8,
  chargingLowV: 13.2,
  chargingHighV: 14.8,
  chargingOkLowV: 13.4,
  chargingOkHighV: 14.7,
  overheatC: 105,
  overheatClearC: 100,
  coldStartC: 40,
  slowWarmupS: 900,
  warmupOkS: 600,
  warmupObserveS: 1200,
  fuelUpPct: 15,
  fuelUpClearPct: 8,
  fuelMinTripKm: 5,
  fuelBaselineMinTrips: 5,
  lowFuelPct: 10,
  lowFuelClearPct: 20
} as const

export type Finding = {
  readonly key: string
  readonly kind: AlertKind
  readonly status: "raise" | "clear"
  readonly severity: Severity
  readonly evidence: Readonly<Record<string, number>>
  readonly tripId: string | null
}

export type FuelBaseline = { readonly medianPer100Km: number | null; readonly trips: number }

const ev = (o: Record<string, number | null | undefined>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(o)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v
  return out
}

export const evaluateTrip = (
  insight: TripInsight,
  extras: TripExtras,
  baseline: FuelBaseline
): ReadonlyArray<Finding> => {
  const T = THRESHOLDS
  const out: Array<Finding> = []
  const tripId = insight.tripId
  const raise = (key: string, kind: AlertKind, severity: Severity, evidence: Record<string, number>) =>
    out.push({ key, kind, status: "raise", severity, evidence, tripId })
  const clear = (key: string, kind: AlertKind) =>
    out.push({ key, kind, status: "clear", severity: "info", evidence: {}, tripId })

  const resting = insight.restingVoltageV
  const crank = insight.crankMinV ?? null
  if (resting !== null || crank !== null) {
    const evidence = ev({ restingV: resting, crankMinV: crank })
    if ((resting !== null && resting < T.restingWeakV) || (crank !== null && crank < T.crankWeakV))
      raise("battery_weak", "battery_weak", "soon", evidence)
    else if (resting !== null && resting < T.restingWatchV) raise("battery_weak", "battery_weak", "watch", evidence)
    else if ((resting === null || resting >= T.restingOkV) && (crank === null || crank >= T.crankOkV))
      clear("battery_weak", "battery_weak")
  }

  const charging = insight.chargingAvgV ?? null
  if (charging !== null) {
    const evidence = ev({
      chargingAvgV: charging,
      chargingMinV: extras.chargingMinV,
      chargingMaxV: extras.chargingMaxV
    })
    if (charging < T.chargingLowV) raise("charging_problem:low", "charging_problem", "soon", evidence)
    else if (charging >= T.chargingOkLowV) clear("charging_problem:low", "charging_problem")
    if (charging > T.chargingHighV) raise("charging_problem:high", "charging_problem", "urgent", evidence)
    else if (charging <= T.chargingOkHighV) clear("charging_problem:high", "charging_problem")
  }

  if (insight.maxCoolantC !== null) {
    if (insight.maxCoolantC > T.overheatC)
      raise("overheating", "overheating", "urgent", ev({ maxCoolantC: insight.maxCoolantC }))
    else if (insight.maxCoolantC < T.overheatClearC && insight.durationS >= 300) clear("overheating", "overheating")
  }

  const start = insight.startCoolantC ?? null
  if (start !== null && start < T.coldStartC) {
    if (insight.warmupS !== null) {
      if (insight.warmupS > T.slowWarmupS && start < T.coldStartC) {
        raise("slow_warmup", "slow_warmup", "watch", ev({ startCoolantC: start, warmupS: insight.warmupS }))
      } else if (insight.warmupS <= T.warmupOkS) clear("slow_warmup", "slow_warmup")
    } else if (insight.movingS + insight.idleS >= T.warmupObserveS && (insight.maxCoolantC ?? 0) < 70) {
      raise(
        "slow_warmup",
        "slow_warmup",
        "watch",
        ev({ startCoolantC: start, maxCoolantC: insight.maxCoolantC, observedS: insight.movingS + insight.idleS })
      )
    }
  }

  if (
    insight.fuelPer100Km !== null &&
    insight.distanceKm !== null &&
    insight.distanceKm >= T.fuelMinTripKm &&
    baseline.medianPer100Km !== null &&
    baseline.trips >= T.fuelBaselineMinTrips
  ) {
    const deltaPct = ((insight.fuelPer100Km - baseline.medianPer100Km) / baseline.medianPer100Km) * 100
    const evidence = ev({
      fuelPer100Km: insight.fuelPer100Km,
      medianPer100Km: baseline.medianPer100Km,
      deltaPct,
      baselineTrips: baseline.trips
    })
    if (deltaPct > T.fuelUpPct) raise("fuel_consumption_up", "fuel_consumption_up", "watch", evidence)
    else if (deltaPct <= T.fuelUpClearPct) clear("fuel_consumption_up", "fuel_consumption_up")
  }

  const level = insight.endFuelLevelPct ?? null
  if (level !== null) {
    if (level < T.lowFuelPct) raise("low_fuel", "low_fuel", "watch", ev({ fuelLevelPct: level }))
    else if (level >= T.lowFuelClearPct) clear("low_fuel", "low_fuel")
  }
  return out
}

export const evaluateDtc = (
  report: { readonly milOn: boolean; readonly tripId: string | null },
  codes: ReadonlyArray<{ readonly code: string; readonly severity: Severity }>
): ReadonlyArray<Finding> => {
  if (!report.milOn && codes.length === 0) {
    return [
      {
        key: "check_engine",
        kind: "check_engine",
        status: "clear",
        severity: "info",
        evidence: {},
        tripId: report.tripId
      }
    ]
  }
  const worst = codes.reduce<Severity>((s, c) => maxSeverity(s, c.severity), "watch")
  const severity = codes.length === 0 ? "soon" : worst
  return [
    {
      key: "check_engine",
      kind: "check_engine",
      status: "raise",
      severity,
      evidence: { codes: codes.length, milOn: report.milOn ? 1 : 0 },
      tripId: report.tripId
    }
  ]
}

export type AlertRow = {
  readonly id: string
  readonly dedupKey: string
  readonly kind: AlertKind
  readonly severity: Severity
  readonly createdAt: number
  readonly resolvedAt: number | null
  readonly tripId: string | null
  readonly evidence: Record<string, number>
}

const toRow = (r: Record<string, string | number | null>): AlertRow => ({
  id: str(r["id"]),
  dedupKey: str(r["dedup_key"]),
  kind: str(r["kind"]) as AlertKind,
  severity: str(r["severity"]) as Severity,
  createdAt: Number(r["created_at"]),
  resolvedAt: typeof r["resolved_at"] === "number" ? r["resolved_at"] : null,
  tripId: typeof r["trip_id"] === "string" ? r["trip_id"] : null,
  evidence: JSON.parse(str(r["evidence_json"]) || "{}") as Record<string, number>
})

export const readAlerts = (
  sql: CarSql,
  where: string,
  params: ReadonlyArray<string | number> = []
): ReadonlyArray<AlertRow> => sql.all(`SELECT * FROM car_alerts ${where}`, params).map(toRow)

export const applyFindings = (sql: CarSql, findings: ReadonlyArray<Finding>, now: number): void => {
  for (const f of findings) {
    const open = sql.all(`SELECT id, severity FROM car_alerts WHERE dedup_key = ? AND resolved_at IS NULL`, [f.key])[0]
    if (f.status === "clear") {
      if (open !== undefined)
        sql.run(`UPDATE car_alerts SET resolved_at = ?, updated_at = ? WHERE id = ?`, [now, now, str(open["id"])])
      continue
    }
    const evidence = JSON.stringify(f.evidence)
    if (open === undefined) {
      const n = Number(sql.all(`SELECT COUNT(*) AS c FROM car_alerts WHERE dedup_key = ?`, [f.key])[0]?.["c"] ?? 0)
      sql.run(
        `INSERT INTO car_alerts (id, dedup_key, kind, severity, created_at, updated_at, resolved_at, notified_at, trip_id, evidence_json) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        [`${f.key}@${now}-${n}`, f.key, f.kind, f.severity, now, now, f.tripId, evidence]
      )
      continue
    }
    const escalated = SEVERITY_RANK[f.severity] > SEVERITY_RANK[str(open["severity"]) as Severity]
    sql.run(
      `UPDATE car_alerts SET evidence_json = ?, updated_at = ?, trip_id = ?${escalated ? ", severity = ?, notified_at = NULL" : ""} WHERE id = ?`,
      escalated ? [evidence, now, f.tripId, f.severity, str(open["id"])] : [evidence, now, f.tripId, str(open["id"])]
    )
  }
}
