import type { Gap } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"

/** Samples further apart than this are never integrated across (adapter stall, app backgrounded). */
export const MAX_STEP_SECONDS = 10
const MAX_GPS_ACCURACY_M = 50
const MAX_PLAUSIBLE_KMH = 300

export type FuelSource = "pid_5e" | "maf_estimate" | "none"

export interface TripMetrics {
  readonly version: 1
  readonly points: number
  readonly startTs: number | undefined
  readonly endTs: number | undefined
  /** Wall-clock span, last - first sample. */
  readonly durationSeconds: number
  /** Time actually integrated (excludes gaps and jumps). */
  readonly activeSeconds: number
  readonly distanceKm: number | undefined
  readonly distanceSource: "obd" | "gps" | "none"
  readonly avgSpeedKmh: number | undefined
  readonly maxSpeedKmh: number | undefined
  readonly idleSeconds: number
  readonly fuelLiters: number | undefined
  /** Distance over the same intervals the fuel was integrated on. */
  readonly fuelDistanceKm: number | undefined
  readonly fuelPer100Km: number | undefined
  readonly fuelIsEstimate: boolean
  readonly avgCoolantC: number | undefined
  readonly coolantSamples: number
}

const rad = (d: number) => (d * Math.PI) / 180

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)))
}

const inGap = (gaps: ReadonlyArray<Gap>, a: number, b: number) => gaps.some((g) => g.from < b && g.to > a)

interface Step {
  readonly dt: number
  readonly obdKm: number | undefined
  readonly gpsKm: number | undefined
  readonly fuelL: number | undefined
  readonly idle: boolean
}

const num = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

/** Per-trip metrics. Never interpolates across gaps or time jumps > 10 s. */
export const analyzeTrip = (
  input: ReadonlyArray<Sample>,
  gaps: ReadonlyArray<Gap>,
  fuelRateSource: FuelSource
): TripMetrics => {
  const samples = [...input].sort((a, b) => a.ts - b.ts)
  const steps: Array<Step> = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample
    const b = samples[i] as Sample
    const dt = (b.ts - a.ts) / 1000
    if (dt <= 0 || dt > MAX_STEP_SECONDS || inGap(gaps, a.ts, b.ts)) continue
    const obdKm = num(a.speedKmh) && num(b.speedKmh) ? (((a.speedKmh + b.speedKmh) / 2) * dt) / 3600 : undefined
    let gpsKm: number | undefined
    if (num(a.lat) && num(a.lon) && num(b.lat) && num(b.lon)) {
      const accOk = (s: Sample) => !num(s.gpsAccuracyM) || s.gpsAccuracyM <= MAX_GPS_ACCURACY_M
      if (accOk(a) && accOk(b)) {
        const km = haversineKm(a.lat, a.lon, b.lat, b.lon)
        if (km * 1000 >= 2 && (km / dt) * 3600 <= MAX_PLAUSIBLE_KMH) gpsKm = km
        else if (km * 1000 < 2) gpsKm = 0
      }
    }
    const fuelL = num(a.fuelRateLph) && num(b.fuelRateLph) ? (((a.fuelRateLph + b.fuelRateLph) / 2) * dt) / 3600 : undefined
    const idle = num(a.rpm) && a.rpm > 0 && num(a.speedKmh) && a.speedKmh === 0
    steps.push({ dt, obdKm, gpsKm, fuelL, idle })
  }

  const obdSteps = steps.filter((s) => s.obdKm !== undefined).length
  const gpsSteps = steps.filter((s) => s.gpsKm !== undefined).length
  const source: "obd" | "gps" | "none" =
    steps.length === 0 ? "none" : obdSteps > 0 && obdSteps >= steps.length / 2 ? "obd" : gpsSteps > 0 ? "gps" : obdSteps > 0 ? "obd" : "none"
  const km = (s: Step) => (source === "obd" ? s.obdKm : source === "gps" ? s.gpsKm : undefined)

  const distanceKm = source === "none" ? undefined : steps.reduce((t, s) => t + (km(s) ?? 0), 0)
  const activeSeconds = steps.reduce((t, s) => t + s.dt, 0)
  const speedSeconds = steps.filter((s) => km(s) !== undefined).reduce((t, s) => t + s.dt, 0)
  const idleSeconds = steps.filter((s) => s.idle).reduce((t, s) => t + s.dt, 0)

  const fuelSteps = steps.filter((s) => s.fuelL !== undefined)
  const fuelLiters = fuelSteps.length === 0 ? undefined : fuelSteps.reduce((t, s) => t + (s.fuelL ?? 0), 0)
  const fuelDistanceKm = fuelSteps.length === 0 || source === "none" ? undefined : fuelSteps.reduce((t, s) => t + (km(s) ?? 0), 0)

  const speeds = samples.map((s) => (num(s.speedKmh) ? s.speedKmh : s.gpsSpeedKmh)).filter(num)
  const coolant = samples.map((s) => s.coolantC).filter(num)
  const first = samples[0]
  const last = samples[samples.length - 1]
  return {
    version: 1,
    points: samples.length,
    startTs: first?.ts,
    endTs: last?.ts,
    durationSeconds: first === undefined || last === undefined ? 0 : (last.ts - first.ts) / 1000,
    activeSeconds,
    distanceKm,
    distanceSource: source,
    avgSpeedKmh: distanceKm === undefined || speedSeconds === 0 ? undefined : distanceKm / (speedSeconds / 3600),
    maxSpeedKmh: speeds.length === 0 ? undefined : Math.max(...speeds),
    idleSeconds,
    fuelLiters,
    fuelDistanceKm,
    fuelPer100Km:
      fuelLiters === undefined || fuelDistanceKm === undefined || fuelDistanceKm < 0.5
        ? undefined
        : (fuelLiters / fuelDistanceKm) * 100,
    fuelIsEstimate: fuelRateSource === "maf_estimate" && fuelLiters !== undefined,
    avgCoolantC: coolant.length === 0 ? undefined : coolant.reduce((a, b) => a + b, 0) / coolant.length,
    coolantSamples: coolant.length
  }
}

export interface TotalMetrics {
  readonly trips: number
  readonly points: number
  readonly durationSeconds: number
  readonly distanceKm: number
  readonly avgSpeedKmh: number | undefined
  readonly maxSpeedKmh: number | undefined
  readonly idleSeconds: number
  readonly fuelLiters: number | undefined
  readonly fuelPer100Km: number | undefined
  readonly fuelIsEstimate: boolean
  readonly avgCoolantC: number | undefined
}

export const combineMetrics = (all: ReadonlyArray<TripMetrics>): TotalMetrics => {
  const sum = (f: (m: TripMetrics) => number) => all.reduce((t, m) => t + f(m), 0)
  const distanceKm = sum((m) => m.distanceKm ?? 0)
  const speedSeconds = sum((m) => (m.avgSpeedKmh !== undefined && m.distanceKm !== undefined && m.avgSpeedKmh > 0 ? (m.distanceKm / m.avgSpeedKmh) * 3600 : 0))
  const withFuel = all.filter((m) => m.fuelLiters !== undefined)
  const fuelLiters = withFuel.length === 0 ? undefined : withFuel.reduce((t, m) => t + (m.fuelLiters ?? 0), 0)
  const fuelKm = withFuel.reduce((t, m) => t + (m.fuelDistanceKm ?? 0), 0)
  const coolN = sum((m) => m.coolantSamples)
  const maxes = all.map((m) => m.maxSpeedKmh).filter(num)
  return {
    trips: all.length,
    points: sum((m) => m.points),
    durationSeconds: sum((m) => m.durationSeconds),
    distanceKm,
    avgSpeedKmh: speedSeconds === 0 ? undefined : distanceKm / (speedSeconds / 3600),
    maxSpeedKmh: maxes.length === 0 ? undefined : Math.max(...maxes),
    idleSeconds: sum((m) => m.idleSeconds),
    fuelLiters,
    fuelPer100Km: fuelLiters === undefined || fuelKm < 0.5 ? undefined : (fuelLiters / fuelKm) * 100,
    fuelIsEstimate: all.some((m) => m.fuelIsEstimate),
    avgCoolantC: coolN === 0 ? undefined : sum((m) => (m.avgCoolantC ?? 0) * m.coolantSamples) / coolN
  }
}

export const METRIC_NAMES = [
  "distanceKm",
  "durationSeconds",
  "avgSpeedKmh",
  "maxSpeedKmh",
  "idleSeconds",
  "fuelLiters",
  "fuelPer100Km",
  "avgCoolantC",
  "points"
] as const
export type MetricName = (typeof METRIC_NAMES)[number]
