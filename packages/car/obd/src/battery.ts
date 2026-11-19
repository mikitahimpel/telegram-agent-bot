import type { BatteryEvents } from "@bot/car-format/manifest"

export const RUNNING_RPM = 300
export const CRANK_WINDOW_MS = 6000
export const CRANK_MIN_DIP_V = 0.3
export const OFF_RECENT_MS = 60_000
export const CHARGING_SETTLE_MS = 10_000
export const CHARGING_FIRST_REPORT_MS = 30_000
const OFF_RING_MAX = 120

export type BatteryEvent =
  | { readonly _tag: "Resting"; readonly at: number; readonly volts: number; readonly samples: number }
  | {
      readonly _tag: "Cranking"
      readonly at: number
      readonly minV: number
      readonly restingV: number
      readonly durationMs: number
      readonly samples: number
    }
  | {
      readonly _tag: "Charging"
      readonly at: number
      readonly volts: number
      readonly minV: number
      readonly maxV: number
      readonly samples: number
    }

type VoltageSample = { readonly ts: number; readonly v: number }

export type BatteryTracker = {
  readonly voltage: (ts: number, volts: number | undefined) => ReadonlyArray<BatteryEvent>
  readonly rpm: (ts: number, rpm: number | undefined) => ReadonlyArray<BatteryEvent>
  readonly markOff: (ts: number) => ReadonlyArray<BatteryEvent>
  readonly report: () => BatteryEvents
  readonly isRunning: () => boolean
}

const median = (xs: ReadonlyArray<number>): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

const round = (n: number): number => Math.round(n * 100) / 100

export const makeBatteryTracker = (): BatteryTracker => {
  let running = false
  let runningSince = 0
  let lastOffAt: number | undefined
  let ring: Array<VoltageSample> = []
  let charging: Array<VoltageSample> = []
  let chargingReported = false
  let events: BatteryEvents = {}

  const chargingEvent = (at: number): BatteryEvent | undefined => {
    const eligible = charging.filter((s) => s.ts >= runningSince + CHARGING_SETTLE_MS)
    if (eligible.length < 3) return undefined
    const vs = eligible.map((s) => s.v)
    const volts = round(median(vs))
    const minV = round(Math.min(...vs))
    const maxV = round(Math.max(...vs))
    events = {
      ...events,
      chargingV: volts,
      chargingMinV: minV,
      chargingMaxV: maxV,
      chargingSamples: vs.length,
      chargingAt: at
    }
    return { _tag: "Charging", at, volts, minV, maxV, samples: vs.length }
  }

  const engineStarted = (ts: number): ReadonlyArray<BatteryEvent> => {
    const out: Array<BatteryEvent> = []
    events = {}
    const windowStart = ts - CRANK_WINDOW_MS
    const inWindow = ring.filter((s) => s.ts >= windowStart)
    const before = ring.filter((s) => s.ts < windowStart).slice(-10)
    const observedOff = lastOffAt !== undefined && ts - lastOffAt <= OFF_RECENT_MS
    if (observedOff) {
      const restingSource = before.length > 0 ? before : inWindow.slice(0, 1)
      if (restingSource.length > 0) {
        const restingV = round(median(restingSource.map((s) => s.v)))
        const at = (restingSource[restingSource.length - 1] as VoltageSample).ts
        events = { ...events, restingV, restingAt: at }
        out.push({ _tag: "Resting", at, volts: restingV, samples: restingSource.length })
        if (inWindow.length >= 2) {
          const low = inWindow.reduce((a, b) => (b.v < a.v ? b : a))
          if (restingV - low.v >= CRANK_MIN_DIP_V) {
            const dipStart = inWindow.find((s) => restingV - s.v >= CRANK_MIN_DIP_V) ?? low
            const durationMs = ts - dipStart.ts
            const minV = round(low.v)
            events = {
              ...events,
              crankMinV: minV,
              crankAt: low.ts,
              crankDurationMs: durationMs,
              crankSamples: inWindow.length
            }
            out.push({ _tag: "Cranking", at: low.ts, minV, restingV, durationMs, samples: inWindow.length })
          }
        }
      }
    }
    running = true
    runningSince = ts
    charging = []
    chargingReported = false
    ring = []
    return out
  }

  const tracker: BatteryTracker = {
    voltage: (ts, volts) => {
      if (volts === undefined || volts < 5 || volts > 20) return []
      if (!running) {
        ring.push({ ts, v: volts })
        if (ring.length > OFF_RING_MAX) ring = ring.slice(-OFF_RING_MAX)
        return []
      }
      charging.push({ ts, v: volts })
      if (!chargingReported && ts - runningSince >= CHARGING_FIRST_REPORT_MS) {
        const e = chargingEvent(ts)
        if (e !== undefined) {
          chargingReported = true
          return [e]
        }
      }
      return []
    },
    rpm: (ts, rpm) => {
      if (rpm === undefined) {
        if (!running) lastOffAt = ts
        return []
      }
      const on = rpm > RUNNING_RPM
      if (!running && on) return engineStarted(ts)
      if (running && !on) return tracker.markOff(ts)
      if (!running) lastOffAt = ts
      return []
    },
    markOff: (ts) => {
      const out: Array<BatteryEvent> = []
      if (running) {
        const e = chargingEvent(ts)
        if (e !== undefined) out.push(e)
      }
      running = false
      lastOffAt = ts
      ring = []
      return out
    },
    report: () => events,
    isRunning: () => running
  }
  return tracker
}
