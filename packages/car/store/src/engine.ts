import { Effect, Schema } from "effect"
import { explainDtc } from "@bot/car-dtc/lookup"
import { parseCsv } from "@bot/car-format/csv"
import {
  type Alert,
  type AlertKind,
  type CarOverview,
  type DtcExplanation,
  type DtcKind,
  type DtcReport,
  type PeriodStats,
  type SeriesColumn,
  type Severity,
  type TripInsight,
  type TripSeries
} from "@bot/car-format/insights"
import { TripManifest } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import { COLUMNS } from "@bot/car-format/sample"
import type { Lang } from "@bot/core-contracts/lang"
import { applyFindings, evaluateDtc, evaluateTrip, readAlerts, SEVERITY_RANK, THRESHOLDS, type AlertRow, type Finding } from "./alerts.ts"
import { runGuarded, type QueryResult } from "./guard.ts"
import { compareToUsual, computeTrip, median, withFuelEstimate, type Usual } from "./insight.ts"
import { renderAlert } from "./render.ts"
import { migrate } from "./schema.ts"
import { buildSeries, clampPoints, DEFAULT_SERIES_COLUMNS } from "./series.ts"
import { num, numOrNull, str, type CarSql, type SqlRow, type SqlValue } from "./sql.ts"

const DAY = 86_400_000
const decodeManifest = Schema.decodeUnknownSync(TripManifest)

export type ChunkOutcome = {
  readonly stored: "new" | "already" | "replaced"
  readonly complete: boolean
}

export type PendingNotifications = {
  readonly alerts: ReadonlyArray<Alert>
  readonly codes: ReadonlyArray<DtcExplanation>
}

export type WeeklyStats = {
  readonly from: number
  readonly to: number
  readonly trips: number
  readonly distanceKm: number
  readonly durationS: number
  readonly fuelPer100Km: number | null
  readonly previousTrips: number
  readonly previousDistanceKm: number
  readonly previousFuelPer100Km: number | null
  readonly idleShare: number | null
  readonly hardEvents: number
  readonly maxCoolantC: number | null
  readonly openAlerts: ReadonlyArray<Alert>
  readonly newAlerts: number
  readonly activeCodes: number
  readonly batteryStatus: "good" | "watch" | "weak" | "unknown"
  readonly lastRestingV: number | null
}

export type TripCounts = { readonly trips: number; readonly complete: number }

export type CarEngine = {
  readonly ingestManifest: (manifest: TripManifest) => ChunkOutcome
  readonly ingestChunk: (tripId: string, seq: number, sha256: string, csv: string) => ChunkOutcome
  readonly putDtc: (report: DtcReport, lang: Lang) => ReadonlyArray<DtcExplanation>
  readonly overview: (lang: Lang) => CarOverview
  readonly tripInsight: (tripId: string) => TripInsight | null
  readonly tripSeries: (tripId: string, points: number, columns: ReadonlyArray<SeriesColumn>) => TripSeries | null
  readonly alerts: (lang: Lang) => ReadonlyArray<Alert>
  readonly dtcCurrent: (lang: Lang) => { readonly readAt: number | null; readonly milOn: boolean; readonly codes: ReadonlyArray<DtcExplanation> }
  readonly query: (text: string) => QueryResult
  readonly pending: (lang: Lang) => PendingNotifications
  readonly markNotified: (alertIds: ReadonlyArray<string>, codes: ReadonlyArray<{ readonly code: string; readonly kind: DtcKind }>) => void
  readonly weekly: (lang: Lang) => WeeklyStats
  readonly counts: () => TripCounts
  readonly knownChunks: (tripId: string) => ReadonlyArray<{ readonly seq: number; readonly sha256: string }>
  readonly getMeta: (key: string) => string | null
  readonly setMeta: (key: string, value: string) => void
}

const SAMPLE_COLUMNS = COLUMNS.map(([name]) => name)

const rowToSample = (r: SqlRow): Sample => {
  const out: Record<string, number> = {}
  for (const [name, key] of COLUMNS) {
    const v = r[name]
    if (typeof v === "number") out[key] = v
  }
  return out as unknown as Sample
}

const isoWeekKey = (ms: number): string => {
  const d = new Date(ms)
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const day = new Date(t).getUTCDay() || 7
  const thursday = t + (4 - day) * DAY
  const year = new Date(thursday).getUTCFullYear()
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7)
  return `${year}-W${String(week).padStart(2, "0")}`
}

const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7)

type TripAgg = {
  readonly startedAt: number
  readonly distanceKm: number
  readonly durationS: number
  readonly fuelL: number | null
  readonly fuelDistanceKm: number | null
  readonly idleS: number
  readonly hard: number
  readonly maxCoolantC: number | null
}

const aggOf = (r: SqlRow): TripAgg => ({
  startedAt: Number(r["started_at"]),
  distanceKm: num(r["distance_km"]) ?? 0,
  durationS: num(r["duration_s"]) ?? 0,
  fuelL: numOrNull(r["fuel_l"]),
  fuelDistanceKm: numOrNull(r["fuel_distance_km"]),
  idleS: num(r["idle_s"]) ?? 0,
  hard: (num(r["hard_accelerations"]) ?? 0) + (num(r["hard_brakings"]) ?? 0),
  maxCoolantC: numOrNull(r["max_coolant_c"])
})

const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

const periodStats = (period: string, rows: ReadonlyArray<TripAgg>): PeriodStats => {
  const distanceKm = rows.reduce((t, r) => t + r.distanceKm, 0)
  const durationS = rows.reduce((t, r) => t + r.durationS, 0)
  const fuelRows = rows.filter((r) => r.fuelL !== null && r.fuelDistanceKm !== null)
  const fuelL = fuelRows.length === 0 ? null : fuelRows.reduce((t, r) => t + (r.fuelL as number), 0)
  const fuelKm = fuelRows.reduce((t, r) => t + (r.fuelDistanceKm as number), 0)
  return {
    period,
    trips: rows.length,
    distanceKm: r2(distanceKm),
    durationS: r2(durationS, 0),
    fuelL: fuelL === null ? null : r2(fuelL),
    fuelPer100Km: fuelL === null || fuelKm < 0.5 ? null : r2((fuelL / fuelKm) * 100),
    avgSpeedKmh: durationS === 0 ? null : r2(distanceKm / (durationS / 3600), 1),
    idleShare: durationS === 0 ? null : r2(rows.reduce((t, r) => t + r.idleS, 0) / durationS, 3)
  }
}

const groupBy = (rows: ReadonlyArray<TripAgg>, key: (ms: number) => string, limit: number): ReadonlyArray<PeriodStats> => {
  const groups = new Map<string, Array<TripAgg>>()
  for (const r of rows) {
    const k = key(r.startedAt)
    const g = groups.get(k)
    if (g === undefined) groups.set(k, [r])
    else g.push(r)
  }
  return [...groups.keys()].sort().reverse().slice(0, limit).map((k) => periodStats(k, groups.get(k) as Array<TripAgg>))
}

const batteryStatus = (resting: number | null, crank: number | null): "good" | "watch" | "weak" | "unknown" => {
  if (resting === null && crank === null) return "unknown"
  if ((resting !== null && resting < THRESHOLDS.restingWeakV) || (crank !== null && crank < THRESHOLDS.crankWeakV)) return "weak"
  if (resting !== null && resting < THRESHOLDS.restingWatchV) return "watch"
  return "good"
}

export const makeEngine = (sql: CarSql, clock: () => number = Date.now): CarEngine => {
  migrate(sql)

  const one = (q: string, p: ReadonlyArray<SqlValue> = []): SqlRow | undefined => sql.all(q, p)[0]

  const loadSamples = (tripId: string): ReadonlyArray<Sample> =>
    sql.all(`SELECT ${SAMPLE_COLUMNS.join(", ")} FROM car_samples WHERE trip_id = ? ORDER BY ts, seq, n`, [tripId]).map(rowToSample)

  const manifestOf = (row: SqlRow): TripManifest | undefined => {
    const text = row["manifest_json"]
    if (typeof text !== "string") return undefined
    try {
      return decodeManifest(JSON.parse(text))
    } catch {
      return undefined
    }
  }

  const baselineFor = (tripId: string, startedAt: number, avgSpeed: number | null) => {
    const rows = sql.all(
      `SELECT fuel_per_100km, avg_speed_kmh FROM car_trips WHERE complete = 1 AND trip_id != ? AND started_at < ? AND started_at >= ? AND distance_km >= 3`,
      [tripId, startedAt, startedAt - 30 * DAY]
    )
    const fuel = rows.filter((r) => typeof r["fuel_per_100km"] === "number")
    const similar =
      avgSpeed === null
        ? []
        : fuel.filter((r) => typeof r["avg_speed_kmh"] === "number" && Math.abs((r["avg_speed_kmh"] as number) - avgSpeed) <= avgSpeed * 0.3)
    const pool = similar.length >= THRESHOLDS.fuelBaselineMinTrips ? similar : fuel
    const speeds = rows.map((r) => r["avg_speed_kmh"]).filter((v): v is number => typeof v === "number")
    const usual: Usual = {
      fuelPer100Km: median(pool.map((r) => r["fuel_per_100km"] as number)) ?? null,
      avgSpeedKmh: median(speeds) ?? null
    }
    return { usual, fuel: { medianPer100Km: usual.fuelPer100Km, trips: pool.length } }
  }

  const buildInsight = (row: SqlRow, complete: boolean) => {
    const tripId = str(row["trip_id"])
    const samples = loadSamples(tripId)
    const manifest = manifestOf(row)
    const startedAt = Number(row["started_at"])
    const endedAt = typeof row["ended_at"] === "number" ? row["ended_at"] : (samples[samples.length - 1]?.ts ?? startedAt)
    const computed = computeTrip({ tripId, startedAt, endedAt, complete, gaps: manifest?.gaps ?? JSON.parse(str(row["gaps_json"]) || "[]"), samples })
    const base = baselineFor(tripId, startedAt, computed.insight.avgSpeedKmh)
    const insight = compareToUsual(withFuelEstimate(computed.insight, str(row["fuel_rate_source"])), base.usual)
    return { insight, extras: computed.extras, baseline: base.fuel }
  }

  const computeAndStore = (tripId: string): void => {
    const row = one(`SELECT * FROM car_trips WHERE trip_id = ?`, [tripId])
    if (row === undefined) return
    const { insight: i, extras, baseline } = buildInsight(row, true)
    const now = clock()
    sql.transaction(() => {
      sql.run(
        `UPDATE car_trips SET computed_at = ?, points = ?, duration_s = ?, moving_s = ?, idle_s = ?, distance_km = ?, avg_speed_kmh = ?, avg_moving_speed_kmh = ?, max_speed_kmh = ?, fuel_l = ?, fuel_distance_km = ?, fuel_per_100km = ?, fuel_is_estimate = ?, idle_fuel_l = ?, max_rpm = ?, avg_rpm = ?, start_coolant_c = ?, max_coolant_c = ?, warmup_s = ?, min_voltage_v = ?, resting_voltage_v = ?, crank_min_v = ?, charging_avg_v = ?, end_fuel_level_pct = ?, hard_accelerations = ?, hard_brakings = ?, insight_json = ? WHERE trip_id = ?`,
        [
          now,
          i.points,
          i.durationS,
          i.movingS,
          i.idleS,
          i.distanceKm,
          i.avgSpeedKmh,
          i.avgMovingSpeedKmh,
          i.maxSpeedKmh,
          i.fuelL,
          extras.fuelDistanceKm,
          i.fuelPer100Km,
          i.fuelIsEstimate ? 1 : 0,
          i.idleFuelL,
          i.maxRpm,
          i.avgRpm,
          i.startCoolantC ?? null,
          i.maxCoolantC,
          i.warmupS,
          i.minVoltageV,
          i.restingVoltageV,
          i.crankMinV ?? null,
          i.chargingAvgV ?? null,
          i.endFuelLevelPct ?? null,
          i.hardAccelerations,
          i.hardBrakings,
          JSON.stringify(i),
          tripId
        ]
      )
      sql.run(
        `INSERT OR REPLACE INTO car_battery_events (trip_id, at, resting_v, crank_min_v, charging_avg_v, charging_min_v, charging_max_v) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tripId, i.startedAt, i.restingVoltageV, i.crankMinV ?? null, i.chargingAvgV ?? null, extras.chargingMinV, extras.chargingMaxV]
      )
      const newer = one(`SELECT 1 AS x FROM car_trips WHERE complete = 1 AND computed_at IS NOT NULL AND trip_id != ? AND started_at > ?`, [tripId, i.startedAt])
      if (newer === undefined) applyFindings(sql, evaluateTrip(i, extras, baseline), now)
    })
  }

  const refresh = (tripId: string): boolean => {
    const row = one(`SELECT * FROM car_trips WHERE trip_id = ?`, [tripId])
    if (row === undefined) return false
    const manifest = manifestOf(row)
    let complete = false
    if (manifest !== undefined && manifest.status === "finished") {
      const have = new Map(sql.all(`SELECT seq, sha256 FROM car_chunks WHERE trip_id = ?`, [tripId]).map((c) => [Number(c["seq"]), str(c["sha256"])]))
      const expected = new Map(manifest.chunks.map((c) => [c.seq, c.sha256]))
      complete = Array.from({ length: manifest.chunkCount }, (_, s) => s).every((s) => have.has(s) && have.get(s) === expected.get(s))
    }
    sql.run(`UPDATE car_trips SET complete = ? WHERE trip_id = ?`, [complete ? 1 : 0, tripId])
    if (complete && row["computed_at"] === null) computeAndStore(tripId)
    return complete
  }

  const ingestManifest: CarEngine["ingestManifest"] = (manifest) => {
    const json = JSON.stringify(manifest)
    const existing = one(`SELECT manifest_json FROM car_trips WHERE trip_id = ?`, [manifest.tripId])
    const changed = existing === undefined || existing["manifest_json"] !== json
    sql.transaction(() => {
      if (existing === undefined) {
        sql.run(`INSERT INTO car_trips (trip_id, started_at, status) VALUES (?, ?, ?)`, [manifest.tripId, manifest.startedAt, manifest.status])
      }
      sql.run(
        `UPDATE car_trips SET started_at = ?, ended_at = ?, status = ?, chunk_count = ?, fuel_rate_source = ?, vin = ?, gaps_json = ?, manifest_json = ?${changed ? ", computed_at = NULL" : ""} WHERE trip_id = ?`,
        [
          manifest.startedAt,
          manifest.endedAt ?? null,
          manifest.status,
          manifest.chunkCount,
          manifest.fuelRateSource,
          manifest.device.vin ?? null,
          JSON.stringify(manifest.gaps),
          json,
          manifest.tripId
        ]
      )
    })
    return { stored: changed ? "new" : "already", complete: refresh(manifest.tripId) }
  }

  const ingestChunk: CarEngine["ingestChunk"] = (tripId, seq, sha256, csv) => {
    const existing = one(`SELECT sha256 FROM car_chunks WHERE trip_id = ? AND seq = ?`, [tripId, seq])
    if (existing !== undefined && existing["sha256"] === sha256) return { stored: "already", complete: refresh(tripId) }
    const samples = Effect.runSync(parseCsv(csv))
    const ts = samples.map((s) => s.ts)
    const now = clock()
    sql.transaction(() => {
      if (one(`SELECT 1 AS x FROM car_trips WHERE trip_id = ?`, [tripId]) === undefined) {
        sql.run(`INSERT INTO car_trips (trip_id, started_at, status) VALUES (?, ?, 'recording')`, [tripId, ts.length === 0 ? now : Math.min(...ts)])
      }
      sql.run(`DELETE FROM car_samples WHERE trip_id = ? AND seq = ?`, [tripId, seq])
      const placeholders = SAMPLE_COLUMNS.map(() => "?").join(", ")
      const insert = `INSERT INTO car_samples (trip_id, seq, n, ${SAMPLE_COLUMNS.join(", ")}) VALUES (?, ?, ?, ${placeholders})`
      samples.forEach((s, n) => {
        sql.run(insert, [tripId, seq, n, ...COLUMNS.map(([, key]) => (typeof s[key] === "number" ? (s[key] as number) : null))])
      })
      sql.run(
        `INSERT OR REPLACE INTO car_chunks (trip_id, seq, sha256, rows, first_ts, last_ts, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tripId, seq, sha256, samples.length, ts.length === 0 ? 0 : Math.min(...ts), ts.length === 0 ? 0 : Math.max(...ts), now]
      )
      sql.run(`UPDATE car_trips SET computed_at = NULL, complete = 0 WHERE trip_id = ?`, [tripId])
    })
    return { stored: existing === undefined ? "new" : "replaced", complete: refresh(tripId) }
  }

  const explain = (row: SqlRow, lang: Lang): DtcExplanation => {
    const info = explainDtc(str(row["code"]), lang)
    return {
      code: str(row["code"]),
      kind: str(row["kind"]) as DtcKind,
      title: info.title,
      meaning: info.meaning,
      severity: info.severity,
      canDrive: info.canDrive,
      commonCauses: info.commonCauses,
      whatToDo: info.whatToDo,
      firstSeenAt: Number(row["first_seen_at"]),
      lastSeenAt: Number(row["last_seen_at"]),
      source: info.source
    }
  }

  const activeCodes = (lang: Lang): ReadonlyArray<DtcExplanation> =>
    sql.all(`SELECT * FROM car_dtc_codes WHERE active = 1 ORDER BY code, kind`).map((r) => explain(r, lang))

  const putDtc: CarEngine["putDtc"] = (report, lang) => {
    const now = clock()
    sql.transaction(() => {
      sql.run(`INSERT INTO car_dtc_reads (read_at, mil_on, trip_id, vin, codes_json) VALUES (?, ?, ?, ?, ?)`, [
        report.readAt,
        report.milOn ? 1 : 0,
        report.tripId,
        report.vin,
        JSON.stringify(report.codes)
      ])
      const seen = new Set<string>()
      for (const c of report.codes) {
        const key = `${c.code}|${c.kind}`
        if (seen.has(key)) continue
        seen.add(key)
        const prev = one(`SELECT active FROM car_dtc_codes WHERE code = ? AND kind = ?`, [c.code, c.kind])
        if (prev === undefined) {
          sql.run(`INSERT INTO car_dtc_codes (code, kind, first_seen_at, last_seen_at, reads, active) VALUES (?, ?, ?, ?, 1, 1)`, [c.code, c.kind, report.readAt, report.readAt])
        } else {
          sql.run(
            `UPDATE car_dtc_codes SET last_seen_at = MAX(last_seen_at, ?), reads = reads + 1, active = 1, cleared_at = NULL${prev["active"] === 1 ? "" : ", notified_at = NULL"} WHERE code = ? AND kind = ?`,
            [report.readAt, c.code, c.kind]
          )
        }
      }
      for (const a of sql.all(`SELECT code, kind FROM car_dtc_codes WHERE active = 1`)) {
        if (!seen.has(`${str(a["code"])}|${str(a["kind"])}`)) {
          sql.run(`UPDATE car_dtc_codes SET active = 0, cleared_at = ? WHERE code = ? AND kind = ?`, [report.readAt, a["code"] ?? null, a["kind"] ?? null])
        }
      }
      const explained = report.codes.map((c) => ({ code: c.code, severity: explainDtc(c.code, "en").severity }))
      const latest = one(`SELECT MAX(read_at) AS m FROM car_dtc_reads`)
      if (latest !== undefined && Number(latest["m"]) <= report.readAt) {
        applyFindings(sql, evaluateDtc({ milOn: report.milOn, tripId: report.tripId }, explained), now)
      }
    })
    const current = new Set(report.codes.map((c) => `${c.code}|${c.kind}`))
    return activeCodes(lang).filter((c) => current.has(`${c.code}|${c.kind}`))
  }

  const toAlert = (row: AlertRow, lang: Lang): Alert => {
    const codes = row.dedupKey === "check_engine" ? activeCodes(lang).map((c) => c.code).join(", ") : ""
    const text = renderAlert(row.dedupKey, row.severity, row.evidence, lang, codes)
    return {
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      title: text.title,
      details: text.details,
      whatToDo: text.whatToDo,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      tripId: row.tripId,
      evidence: row.evidence
    }
  }

  const completeAggs = (): ReadonlyArray<TripAgg> =>
    sql.all(`SELECT * FROM car_trips WHERE complete = 1 AND computed_at IS NOT NULL ORDER BY started_at`).map(aggOf)

  const lastBattery = () => {
    const r = one(`SELECT resting_v, crank_min_v FROM car_battery_events WHERE resting_v IS NOT NULL OR crank_min_v IS NOT NULL ORDER BY at DESC LIMIT 1`)
    const lastResting = one(`SELECT resting_v FROM car_battery_events WHERE resting_v IS NOT NULL ORDER BY at DESC LIMIT 1`)
    const lastCrank = one(`SELECT crank_min_v FROM car_battery_events WHERE crank_min_v IS NOT NULL ORDER BY at DESC LIMIT 1`)
    return {
      lastRestingV: lastResting === undefined ? null : numOrNull(lastResting["resting_v"]),
      lastCrankMinV: lastCrank === undefined ? null : numOrNull(lastCrank["crank_min_v"]),
      any: r !== undefined
    }
  }

  const openAlerts = (lang: Lang) =>
    readAlerts(sql, `WHERE resolved_at IS NULL ORDER BY created_at DESC`).map((a) => toAlert(a, lang))

  return {
    ingestManifest,
    ingestChunk,
    putDtc,
    overview: (lang) => {
      const now = clock()
      const rows = completeAggs()
      const battery = lastBattery()
      const trend = [...sql.all(`SELECT at, resting_v, crank_min_v FROM car_battery_events ORDER BY at DESC LIMIT 30`)]
        .reverse()
        .map((r) => ({ at: Number(r["at"]), restingV: numOrNull(r["resting_v"]), crankMinV: numOrNull(r["crank_min_v"]) }))
      const lastRead = one(`SELECT read_at, mil_on, vin FROM car_dtc_reads ORDER BY read_at DESC LIMIT 1`)
      const vinRow = one(`SELECT vin FROM car_trips WHERE vin IS NOT NULL ORDER BY started_at DESC LIMIT 1`)
      const lastTrip = one(`SELECT MAX(COALESCE(ended_at, started_at)) AS t FROM car_trips`)
      const coolant = rows
        .filter((r) => r.startedAt >= now - 30 * DAY && r.maxCoolantC !== null)
        .map((r) => r.maxCoolantC as number)
      return {
        generatedAt: now,
        vin: vinRow !== undefined ? str(vinRow["vin"]) : lastRead !== undefined && typeof lastRead["vin"] === "string" ? lastRead["vin"] : null,
        lastTripAt: lastTrip === undefined ? null : numOrNull(lastTrip["t"]),
        totals: periodStats("all", rows),
        byMonth: groupBy(rows, monthKey, 12),
        byWeek: groupBy(rows, isoWeekKey, 12),
        battery: {
          status: batteryStatus(battery.lastRestingV, battery.lastCrankMinV),
          lastRestingV: battery.lastRestingV,
          lastCrankMinV: battery.lastCrankMinV,
          trend
        },
        engine: {
          milOn: lastRead !== undefined && lastRead["mil_on"] === 1,
          activeCodes: activeCodes(lang),
          lastScanAt: lastRead === undefined ? null : numOrNull(lastRead["read_at"]),
          maxCoolantC30d: coolant.length === 0 ? null : Math.max(...coolant)
        },
        alerts: openAlerts(lang)
      }
    },
    tripInsight: (tripId) => {
      const row = one(`SELECT * FROM car_trips WHERE trip_id = ?`, [tripId])
      if (row === undefined) return null
      if (row["complete"] === 1 && typeof row["insight_json"] === "string") return JSON.parse(row["insight_json"]) as TripInsight
      return buildInsight(row, row["complete"] === 1).insight
    },
    tripSeries: (tripId, points, columns) => {
      const row = one(`SELECT * FROM car_trips WHERE trip_id = ?`, [tripId])
      if (row === undefined) return null
      const manifest = manifestOf(row)
      return buildSeries(tripId, loadSamples(tripId), manifest?.gaps ?? [], columns.length === 0 ? DEFAULT_SERIES_COLUMNS : columns, clampPoints(points))
    },
    alerts: (lang) =>
      readAlerts(sql, `WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY (resolved_at IS NOT NULL), created_at DESC LIMIT 200`, [clock() - 90 * DAY]).map((a) =>
        toAlert(a, lang)
      ),
    dtcCurrent: (lang) => {
      const read = one(`SELECT read_at, mil_on FROM car_dtc_reads ORDER BY read_at DESC LIMIT 1`)
      return {
        readAt: read === undefined ? null : numOrNull(read["read_at"]),
        milOn: read !== undefined && read["mil_on"] === 1,
        codes: activeCodes(lang)
      }
    },
    query: (text) => runGuarded(sql, text),
    pending: (lang) => ({
      alerts: readAlerts(sql, `WHERE resolved_at IS NULL AND notified_at IS NULL ORDER BY created_at`).map((a) => toAlert(a, lang)),
      codes: sql.all(`SELECT * FROM car_dtc_codes WHERE active = 1 AND notified_at IS NULL ORDER BY code`).map((r) => explain(r, lang))
    }),
    markNotified: (alertIds, codes) => {
      const now = clock()
      sql.transaction(() => {
        for (const id of alertIds) sql.run(`UPDATE car_alerts SET notified_at = ? WHERE id = ?`, [now, id])
        for (const c of codes) sql.run(`UPDATE car_dtc_codes SET notified_at = ? WHERE code = ? AND kind = ?`, [now, c.code, c.kind])
      })
    },
    weekly: (lang) => {
      const now = clock()
      const rows = completeAggs()
      const inRange = (from: number, to: number) => rows.filter((r) => r.startedAt >= from && r.startedAt < to)
      const week = inRange(now - 7 * DAY, now)
      const prev = inRange(now - 14 * DAY, now - 7 * DAY)
      const s = periodStats("week", week)
      const p = periodStats("previous", prev)
      const battery = lastBattery()
      const coolant = week.map((r) => r.maxCoolantC).filter((v): v is number => v !== null)
      return {
        from: now - 7 * DAY,
        to: now,
        trips: s.trips,
        distanceKm: s.distanceKm,
        durationS: s.durationS,
        fuelPer100Km: s.fuelPer100Km,
        previousTrips: p.trips,
        previousDistanceKm: p.distanceKm,
        previousFuelPer100Km: p.fuelPer100Km,
        idleShare: s.idleShare,
        hardEvents: week.reduce((t, r) => t + r.hard, 0),
        maxCoolantC: coolant.length === 0 ? null : Math.max(...coolant),
        openAlerts: openAlerts(lang),
        newAlerts: Number(one(`SELECT COUNT(*) AS c FROM car_alerts WHERE created_at >= ?`, [now - 7 * DAY])?.["c"] ?? 0),
        activeCodes: activeCodes(lang).length,
        batteryStatus: batteryStatus(battery.lastRestingV, battery.lastCrankMinV),
        lastRestingV: battery.lastRestingV
      }
    },
    counts: () => ({
      trips: Number(one(`SELECT COUNT(*) AS c FROM car_trips`)?.["c"] ?? 0),
      complete: Number(one(`SELECT COUNT(*) AS c FROM car_trips WHERE complete = 1`)?.["c"] ?? 0)
    }),
    knownChunks: (tripId) =>
      sql.all(`SELECT seq, sha256 FROM car_chunks WHERE trip_id = ? ORDER BY seq`, [tripId]).map((r) => ({ seq: Number(r["seq"]), sha256: str(r["sha256"]) })),
    getMeta: (key) => {
      const r = one(`SELECT value FROM car_meta WHERE key = ?`, [key])
      return r === undefined ? null : str(r["value"])
    },
    setMeta: (key, value) => sql.run(`INSERT OR REPLACE INTO car_meta (key, value) VALUES (?, ?)`, [key, value])
  }
}

export type { Finding, Severity, AlertKind }
export { SEVERITY_RANK }
