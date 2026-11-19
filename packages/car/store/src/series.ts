import type { SeriesColumn, TripSeries } from "@bot/car-format/insights"
import type { Gap } from "@bot/car-format/manifest"
import { MAX_STEP_SECONDS, isNum } from "@bot/car-format/metrics"
import type { Sample } from "@bot/car-format/sample"

export const SERIES_COLUMNS: ReadonlyArray<SeriesColumn> = [
  "speed_kmh",
  "rpm",
  "coolant_c",
  "intake_c",
  "load_pct",
  "throttle_pct",
  "fuel_rate_lph",
  "fuel_level_pct",
  "voltage_v",
  "lat",
  "lon"
]

export const DEFAULT_SERIES_COLUMNS: ReadonlyArray<SeriesColumn> = [
  "speed_kmh",
  "rpm",
  "coolant_c",
  "fuel_rate_lph",
  "voltage_v"
]
export const MIN_POINTS = 20
export const MAX_POINTS = 5000
export const DEFAULT_POINTS = 600

const KEY: Record<SeriesColumn, keyof Sample> = {
  speed_kmh: "speedKmh",
  rpm: "rpm",
  coolant_c: "coolantC",
  intake_c: "intakeC",
  load_pct: "loadPct",
  throttle_pct: "throttlePct",
  fuel_rate_lph: "fuelRateLph",
  fuel_level_pct: "fuelLevelPct",
  voltage_v: "voltageV",
  lat: "lat",
  lon: "lon"
}

export const parseColumns = (raw: string | null | undefined): ReadonlyArray<SeriesColumn> | undefined => {
  if (raw === undefined || raw === null || raw.trim() === "") return DEFAULT_SERIES_COLUMNS
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
  const valid = names.filter((n): n is SeriesColumn => (SERIES_COLUMNS as ReadonlyArray<string>).includes(n))
  return valid.length === names.length && valid.length > 0 ? [...new Set(valid)] : undefined
}

export const clampPoints = (raw: number): number =>
  Number.isFinite(raw) ? Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(raw))) : DEFAULT_POINTS

const detectGaps = (
  samples: ReadonlyArray<Sample>,
  manifestGaps: ReadonlyArray<Gap>
): Array<{ from: number; to: number }> => {
  const out: Array<{ from: number; to: number }> = manifestGaps.map((g) => ({ from: g.from, to: g.to }))
  for (let i = 1; i < samples.length; i++) {
    const a = (samples[i - 1] as Sample).ts
    const b = (samples[i] as Sample).ts
    if ((b - a) / 1000 > MAX_STEP_SECONDS && !out.some((g) => g.from <= a && g.to >= b)) out.push({ from: a, to: b })
  }
  return out.sort((x, y) => x.from - y.from)
}

const select = (
  samples: ReadonlyArray<Sample>,
  columns: ReadonlyArray<SeriesColumn>,
  buckets: number,
  boundaries: ReadonlySet<number>
) => {
  const picked = new Set<number>(boundaries)
  const size = samples.length / buckets
  const valueColumns = columns.filter((c) => c !== "lat" && c !== "lon")
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size)
    const to = Math.min(samples.length, Math.floor((b + 1) * size))
    if (from >= to) continue
    picked.add(from)
    picked.add(to - 1)
    for (const c of valueColumns) {
      const key = KEY[c]
      let lo = -1
      let hi = -1
      for (let i = from; i < to; i++) {
        const v = (samples[i] as Sample)[key] as number | undefined
        if (v === undefined || !isNum(v)) continue
        if (lo < 0 || v < ((samples[lo] as Sample)[key] as number)) lo = i
        if (hi < 0 || v > ((samples[hi] as Sample)[key] as number)) hi = i
      }
      if (lo >= 0) picked.add(lo)
      if (hi >= 0) picked.add(hi)
    }
  }
  return [...picked].sort((a, b) => a - b)
}

export const buildSeries = (
  tripId: string,
  input: ReadonlyArray<Sample>,
  manifestGaps: ReadonlyArray<Gap>,
  columns: ReadonlyArray<SeriesColumn>,
  points: number
): TripSeries => {
  const samples = [...input].sort((a, b) => a.ts - b.ts)
  const gaps = detectGaps(samples, manifestGaps)
  const boundaries = new Set<number>([0, Math.max(0, samples.length - 1)])
  for (const g of gaps) {
    let before = -1
    for (let i = 0; i < samples.length; i++) {
      const ts = (samples[i] as Sample).ts
      if (ts <= g.from) before = i
      if (ts >= g.to) {
        boundaries.add(i)
        break
      }
    }
    if (before >= 0) boundaries.add(before)
  }
  let chosen: ReadonlyArray<number>
  if (samples.length <= points) chosen = samples.map((_, i) => i)
  else {
    let buckets = Math.max(1, Math.floor(points / 2))
    chosen = select(samples, columns, buckets, boundaries)
    while (chosen.length > points && buckets > 1) {
      buckets = Math.max(1, Math.floor(buckets * Math.min(0.9, points / chosen.length)))
      chosen = select(samples, columns, buckets, boundaries)
    }
  }
  const rows = chosen.map((i) => samples[i] as Sample)
  const cols: Record<string, Array<number | null>> = {}
  for (const c of columns) {
    const key = KEY[c]
    cols[c] = rows.map((s) => {
      const v = s[key]
      return typeof v === "number" && Number.isFinite(v) ? v : null
    })
  }
  return { tripId, ts: rows.map((s) => s.ts), columns: cols, gaps }
}
