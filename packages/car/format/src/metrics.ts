import type { Gap } from "./manifest.ts"
import type { Sample } from "./sample.ts"

export const MAX_STEP_SECONDS = 10
const MAX_GPS_ACCURACY_M = 50
const MAX_PLAUSIBLE_KMH = 300

const rad = (d: number) => (d * Math.PI) / 180

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export const inGap = (gaps: ReadonlyArray<Gap>, a: number, b: number) => gaps.some((g) => g.from < b && g.to > a)

export const isNum = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

export interface DistanceStep {
  readonly dt: number
  readonly obdKm: number | undefined
  readonly gpsKm: number | undefined
}

export const distanceStep = (a: Sample, b: Sample, gaps: ReadonlyArray<Gap> = []): DistanceStep | undefined => {
  const dt = (b.ts - a.ts) / 1000
  if (dt <= 0 || dt > MAX_STEP_SECONDS || inGap(gaps, a.ts, b.ts)) return undefined
  const obdKm = isNum(a.speedKmh) && isNum(b.speedKmh) ? (((a.speedKmh + b.speedKmh) / 2) * dt) / 3600 : undefined
  let gpsKm: number | undefined
  if (isNum(a.lat) && isNum(a.lon) && isNum(b.lat) && isNum(b.lon)) {
    const accOk = (s: Sample) => !isNum(s.gpsAccuracyM) || s.gpsAccuracyM <= MAX_GPS_ACCURACY_M
    if (accOk(a) && accOk(b)) {
      const km = haversineKm(a.lat, a.lon, b.lat, b.lon)
      if (km * 1000 >= 2 && (km / dt) * 3600 <= MAX_PLAUSIBLE_KMH) gpsKm = km
      else if (km * 1000 < 2) gpsKm = 0
    }
  }
  return { dt, obdKm, gpsKm }
}
