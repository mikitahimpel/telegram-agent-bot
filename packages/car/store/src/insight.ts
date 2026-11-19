import type { TripInsight } from "@bot/car-format/insights"
import type { Gap } from "@bot/car-format/manifest"
import { distanceStep, isNum } from "@bot/car-format/metrics"
import type { Sample } from "@bot/car-format/sample"

export type TripInput = {
  readonly tripId: string
  readonly startedAt: number
  readonly endedAt: number
  readonly complete: boolean
  readonly gaps: ReadonlyArray<Gap>
  readonly samples: ReadonlyArray<Sample>
}

export type TripExtras = {
  readonly fuelDistanceKm: number | null
  readonly chargingMinV: number | null
  readonly chargingMaxV: number | null
}

export type Usual = {
  readonly fuelPer100Km: number | null
  readonly avgSpeedKmh: number | null
}

export type ComputedTrip = { readonly insight: TripInsight; readonly extras: TripExtras }

export const SPEED_BAND_EDGES = [0, 10, 30, 50, 70, 90, 110, 130, 250] as const
export const MOVING_KMH = 3
export const HARD_ACCEL_KMH_PER_S = 10
export const HARD_BRAKE_KMH_PER_S = 12.6
export const ENGINE_ON_RPM = 300
export const CHARGING_MIN_RPM = 1200
export const CHARGING_SETTLE_MS = 30_000
export const CHARGING_MIN_SAMPLES = 20
export const COLD_START_C = 50
export const WARM_C = 70

const r = (v: number, digits = 2): number => Math.round(v * 10 ** digits) / 10 ** digits
const rn = (v: number | undefined, digits = 2): number | null =>
  v === undefined || !Number.isFinite(v) ? null : r(v, digits)

export const median = (values: ReadonlyArray<number>): number | undefined => {
  if (values.length === 0) return undefined
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

const speedOf = (s: Sample): number | undefined =>
  isNum(s.speedKmh) ? s.speedKmh : isNum(s.gpsSpeedKmh) ? s.gpsSpeedKmh : undefined

type Step = {
  readonly dt: number
  readonly fuelL: number | undefined
  readonly speed: number | undefined
  readonly idle: boolean
}

const countEvents = (samples: ReadonlyArray<Sample>, gaps: ReadonlyArray<Gap>) => {
  let accel = 0
  let brake = 0
  let accelOn = false
  let brakeOn = false
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample
    const b = samples[i] as Sample
    const dt = (b.ts - a.ts) / 1000
    const va = isNum(a.speedKmh) ? a.speedKmh : undefined
    const vb = isNum(b.speedKmh) ? b.speedKmh : undefined
    const inGap = gaps.some((g) => g.from < b.ts && g.to > a.ts)
    if (dt <= 0 || dt > 3 || inGap || va === undefined || vb === undefined) {
      accelOn = false
      brakeOn = false
      continue
    }
    const rate = (vb - va) / dt
    const hardA = rate >= HARD_ACCEL_KMH_PER_S
    const hardB = rate <= -HARD_BRAKE_KMH_PER_S
    if (hardA && !accelOn) accel++
    if (hardB && !brakeOn) brake++
    accelOn = hardA
    brakeOn = hardB
  }
  return { accel, brake }
}

export const computeTrip = (input: TripInput): ComputedTrip => {
  const samples = [...input.samples].sort((a, b) => a.ts - b.ts)
  const first = samples[0]
  const last = samples[samples.length - 1]
  const steps: Array<Step & { readonly obdKm: number | undefined; readonly gpsKm: number | undefined }> = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample
    const b = samples[i] as Sample
    const d = distanceStep(a, b, input.gaps)
    if (d === undefined) continue
    const fuelL =
      isNum(a.fuelRateLph) && isNum(b.fuelRateLph) ? (((a.fuelRateLph + b.fuelRateLph) / 2) * d.dt) / 3600 : undefined
    const sa = speedOf(a)
    const sb = speedOf(b)
    const speed = sa !== undefined && sb !== undefined ? (sa + sb) / 2 : undefined
    const idle = isNum(a.rpm) && a.rpm > 0 && isNum(a.speedKmh) && a.speedKmh < 1 && isNum(b.speedKmh) && b.speedKmh < 1
    steps.push({ dt: d.dt, obdKm: d.obdKm, gpsKm: d.gpsKm, fuelL, speed, idle })
  }
  const obdSteps = steps.filter((s) => s.obdKm !== undefined).length
  const gpsSteps = steps.filter((s) => s.gpsKm !== undefined).length
  const source: "obd" | "gps" | "none" =
    steps.length === 0
      ? "none"
      : obdSteps > 0 && obdSteps >= steps.length / 2
        ? "obd"
        : gpsSteps > 0
          ? "gps"
          : obdSteps > 0
            ? "obd"
            : "none"
  const kmOf = (s: (typeof steps)[number]) => (source === "obd" ? s.obdKm : source === "gps" ? s.gpsKm : undefined)

  const distanceKm = source === "none" ? undefined : steps.reduce((t, s) => t + (kmOf(s) ?? 0), 0)
  const speedSeconds = steps.filter((s) => kmOf(s) !== undefined).reduce((t, s) => t + s.dt, 0)
  const movingSteps = steps.filter((s) => s.speed !== undefined && s.speed >= MOVING_KMH)
  const movingS = movingSteps.reduce((t, s) => t + s.dt, 0)
  const movingKm = movingSteps.reduce((t, s) => t + (kmOf(s) ?? 0), 0)
  const idleS = steps.filter((s) => s.idle).reduce((t, s) => t + s.dt, 0)

  const fuelSteps = steps.filter((s) => s.fuelL !== undefined)
  const fuelL = fuelSteps.length === 0 ? undefined : fuelSteps.reduce((t, s) => t + (s.fuelL ?? 0), 0)
  const fuelDistanceKm =
    fuelSteps.length === 0 || source === "none" ? undefined : fuelSteps.reduce((t, s) => t + (kmOf(s) ?? 0), 0)
  const idleFuelL =
    fuelSteps.length === 0 ? undefined : fuelSteps.filter((s) => s.idle).reduce((t, s) => t + (s.fuelL ?? 0), 0)
  const fuelPer100 =
    fuelL === undefined || fuelDistanceKm === undefined || fuelDistanceKm < 0.5
      ? undefined
      : (fuelL / fuelDistanceKm) * 100

  const speedBands = SPEED_BAND_EDGES.slice(0, -1).map((from, i) => {
    const to = SPEED_BAND_EDGES[i + 1] as number
    const inBand = steps.filter((s) => s.speed !== undefined && s.speed >= from && s.speed < to)
    const bandFuelSteps = inBand.filter((s) => s.fuelL !== undefined && kmOf(s) !== undefined)
    const fuel = bandFuelSteps.reduce((t, s) => t + (s.fuelL ?? 0), 0)
    const km = bandFuelSteps.reduce((t, s) => t + (kmOf(s) ?? 0), 0)
    return {
      fromKmh: from,
      toKmh: to,
      seconds: r(
        inBand.reduce((t, s) => t + s.dt, 0),
        1
      ),
      fuelPer100Km: km >= 0.3 ? r((fuel / km) * 100) : null
    }
  })

  const speeds = samples.map(speedOf).filter(isNum)
  const rpms = samples.map((s) => s.rpm).filter(isNum)
  const running = rpms.filter((v) => v > 0)
  const coolant = samples.map((s) => s.coolantC).filter(isNum)
  const volts = samples.map((s) => s.voltageV).filter(isNum)

  const runIdx = samples.findIndex((s) => isNum(s.rpm) && s.rpm >= ENGINE_ON_RPM)
  const run = runIdx >= 0 ? (samples[runIdx] as Sample) : undefined
  const preStart =
    runIdx > 0
      ? samples.slice(0, runIdx).filter((s) => isNum(s.voltageV) && run !== undefined && run.ts - s.ts <= 180_000)
      : []
  const restingV = median(preStart.map((s) => s.voltageV as number))
  const crankWindow =
    run !== undefined && runIdx > 0
      ? samples
          .filter((s) => isNum(s.voltageV) && s.ts >= run.ts - 3000 && s.ts <= run.ts + 2000)
          .map((s) => s.voltageV as number)
      : []
  const crankMinV = crankWindow.length === 0 ? undefined : Math.min(...crankWindow)
  const chargingFrom =
    run === undefined ? Infinity : runIdx > 0 ? run.ts + CHARGING_SETTLE_MS : (first?.ts ?? 0) + CHARGING_SETTLE_MS
  const charging = samples
    .filter((s) => isNum(s.voltageV) && isNum(s.rpm) && s.rpm >= CHARGING_MIN_RPM && s.ts >= chargingFrom)
    .map((s) => s.voltageV as number)
  const enoughCharging = charging.length >= CHARGING_MIN_SAMPLES

  const startC = coolant[0]
  const engineStartTs = run?.ts ?? first?.ts
  let warmupS: number | undefined
  if (startC !== undefined && startC < COLD_START_C && engineStartTs !== undefined) {
    const warm = samples.find((s) => isNum(s.coolantC) && s.coolantC >= WARM_C && s.ts >= engineStartTs)
    if (warm !== undefined) warmupS = (warm.ts - engineStartTs) / 1000
  }

  const withFix = samples.filter(
    (s) => isNum(s.lat) && isNum(s.lon) && (!isNum(s.gpsAccuracyM) || s.gpsAccuracyM <= 50)
  )
  const startFix = withFix[0]
  const endFix = withFix[withFix.length - 1]
  const fuelLevels = samples.map((s) => s.fuelLevelPct).filter(isNum)
  const events = countEvents(samples, input.gaps)
  const durationS = first === undefined || last === undefined ? 0 : (last.ts - first.ts) / 1000

  const insight: TripInsight = {
    tripId: input.tripId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    complete: input.complete,
    points: samples.length,
    durationS: r(durationS, 1),
    movingS: r(movingS, 1),
    idleS: r(idleS, 1),
    distanceKm: rn(distanceKm),
    avgSpeedKmh: distanceKm === undefined || speedSeconds === 0 ? null : r(distanceKm / (speedSeconds / 3600), 1),
    avgMovingSpeedKmh: distanceKm === undefined || movingS === 0 ? null : r(movingKm / (movingS / 3600), 1),
    maxSpeedKmh: speeds.length === 0 ? null : r(Math.max(...speeds), 1),
    fuelL: rn(fuelL, 3),
    fuelPer100Km: rn(fuelPer100),
    fuelIsEstimate: false,
    idleFuelL: rn(idleFuelL, 3),
    maxRpm: rpms.length === 0 ? null : Math.round(Math.max(...rpms)),
    avgRpm: running.length === 0 ? null : Math.round(running.reduce((a, b) => a + b, 0) / running.length),
    maxCoolantC: coolant.length === 0 ? null : r(Math.max(...coolant), 1),
    warmupS: rn(warmupS, 0),
    minVoltageV: volts.length === 0 ? null : r(Math.min(...volts)),
    restingVoltageV: rn(restingV),
    hardAccelerations: events.accel,
    hardBrakings: events.brake,
    speedBands,
    route: {
      startLat: startFix?.lat ?? null,
      startLon: startFix?.lon ?? null,
      endLat: endFix?.lat ?? null,
      endLon: endFix?.lon ?? null
    },
    comparedToUsual: { fuelPer100KmDeltaPct: null, avgSpeedDeltaPct: null },
    crankMinV: rn(crankMinV),
    chargingAvgV: enoughCharging ? r(charging.reduce((a, b) => a + b, 0) / charging.length) : null,
    startCoolantC: rn(startC, 1),
    endFuelLevelPct: fuelLevels.length === 0 ? null : r(fuelLevels[fuelLevels.length - 1] as number, 1)
  }
  return {
    insight,
    extras: {
      fuelDistanceKm: rn(fuelDistanceKm),
      chargingMinV: enoughCharging ? r(Math.min(...charging)) : null,
      chargingMaxV: enoughCharging ? r(Math.max(...charging)) : null
    }
  }
}

export const withFuelEstimate = (insight: TripInsight, fuelRateSource: string): TripInsight => ({
  ...insight,
  fuelIsEstimate: fuelRateSource === "maf_estimate" && insight.fuelL !== null
})

export const compareToUsual = (insight: TripInsight, usual: Usual): TripInsight => {
  const delta = (value: number | null, base: number | null): number | null =>
    value === null || base === null || base <= 0 ? null : r(((value - base) / base) * 100, 1)
  return {
    ...insight,
    comparedToUsual: {
      fuelPer100KmDeltaPct: delta(insight.fuelPer100Km, usual.fuelPer100Km),
      avgSpeedDeltaPct: delta(insight.avgSpeedKmh, usual.avgSpeedKmh)
    }
  }
}
