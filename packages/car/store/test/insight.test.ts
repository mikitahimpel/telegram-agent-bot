import { describe, expect, it } from "vite-plus/test"
import { computeTrip } from "../src/insight.ts"
import { buildSeries } from "../src/series.ts"
import { cruise, gen, T0 } from "./helpers.ts"

const input = (samples: ReturnType<typeof gen>, gaps: ReadonlyArray<{ from: number; to: number; reason: "unknown" }> = []) => ({
  tripId: "t",
  startedAt: T0,
  endedAt: T0 + samples.length * 1000,
  complete: true,
  gaps,
  samples
})

describe("computeTrip", () => {
  it("integrates distance, fuel and consumption", () => {
    const { insight } = computeTrip(input(gen(T0, 101, cruise(36, { fuelRateLph: 3.6 }))))
    expect(insight.distanceKm).toBeCloseTo(1, 2)
    expect(insight.fuelL).toBeCloseTo(0.1, 3)
    expect(computeTrip(input(gen(T0, 41, cruise(36, { fuelRateLph: 3.6 })))).insight.fuelPer100Km).toBeNull()
    const long = computeTrip(input(gen(T0, 1801, cruise(36, { fuelRateLph: 3.6 })))).insight
    expect(long.distanceKm).toBeCloseTo(18, 1)
    expect(long.fuelPer100Km).toBeCloseTo(10, 1)
    expect(long.avgMovingSpeedKmh).toBeCloseTo(36, 0)
  })

  it("does not interpolate across gaps", () => {
    const samples = [...gen(T0, 60, cruise(36)), ...gen(T0 + 600_000, 60, cruise(36))]
    const { insight } = computeTrip(input(samples, [{ from: T0 + 59_000, to: T0 + 600_000, reason: "unknown" }]))
    expect(insight.distanceKm).toBeCloseTo(2 * 0.59, 1)
  })

  it("splits moving and idle time and fuel", () => {
    const samples = gen(T0, 200, (t) => (t < 100 ? { speedKmh: 0, rpm: 800, fuelRateLph: 1 } : { speedKmh: 50, rpm: 2000, fuelRateLph: 5 }))
    const { insight } = computeTrip(input(samples))
    expect(insight.idleS).toBeGreaterThan(95)
    expect(insight.movingS).toBeGreaterThan(95)
    expect(insight.idleFuelL).toBeCloseTo((1 * 99) / 3600, 2)
  })

  it("reads resting voltage, cranking dip and charging voltage", () => {
    const samples = gen(T0, 400, (t) => {
      if (t < 20) return { speedKmh: 0, rpm: 0, voltageV: 12.3 }
      if (t < 22) return { speedKmh: 0, rpm: 0, voltageV: 10.1 }
      if (t === 22) return { speedKmh: 0, rpm: 700, voltageV: 9.7 }
      return { speedKmh: 40, rpm: 2000, voltageV: 14.0, coolantC: 20 + t * 0.2 }
    })
    const { insight } = computeTrip(input(samples))
    expect(insight.restingVoltageV).toBeCloseTo(12.3, 2)
    expect(insight.crankMinV).toBeCloseTo(9.7, 2)
    expect(insight.chargingAvgV).toBeCloseTo(14.0, 2)
    expect(insight.startCoolantC).toBeCloseTo(24.6, 1)
  })

  it("measures warm-up from a cold start", () => {
    const samples = gen(T0, 900, (t) => ({ speedKmh: 30, rpm: 1500, coolantC: Math.min(90, 20 + t * 0.2) }))
    expect(computeTrip(input(samples)).insight.warmupS).toBe(250)
  })

  it("counts hard accelerations and brakings once each", () => {
    const speeds = [0, 0, 15, 30, 45, 45, 45, 30, 15, 0]
    const samples = speeds.map((speedKmh, i) => ({ ts: T0 + i * 1000, speedKmh, rpm: 1500 }))
    const { insight } = computeTrip(input(samples))
    expect(insight.hardAccelerations).toBe(1)
    expect(insight.hardBrakings).toBe(1)
  })
})

describe("buildSeries", () => {
  it("keeps min/max spikes and gap borders when downsampling", () => {
    const samples = gen(T0, 5000, (t) => ({ speedKmh: t === 2500 ? 200 : 50, rpm: 2000 }))
    const s = buildSeries("t", samples, [], ["speed_kmh", "rpm"], 100)
    expect(s.ts.length).toBeLessThanOrEqual(100)
    expect(Math.max(...(s.columns["speed_kmh"] as Array<number>))).toBe(200)
    expect(s.ts[0]).toBe(T0)
    expect(s.ts.at(-1)).toBe(T0 + 4999 * 1000)
  })

  it("returns every point when under the limit and reports gaps", () => {
    const samples = [...gen(T0, 30, cruise(50)), ...gen(T0 + 200_000, 30, cruise(50))]
    const s = buildSeries("t", samples, [], ["speed_kmh"], 600)
    expect(s.ts).toHaveLength(60)
    expect(s.gaps).toEqual([{ from: T0 + 29_000, to: T0 + 200_000 }])
  })

  it("keeps the points on both sides of a gap when downsampling", () => {
    const samples = [...gen(T0, 1000, cruise(50)), ...gen(T0 + 5_000_000, 1000, cruise(50))]
    const s = buildSeries("t", samples, [], ["speed_kmh"], 50)
    expect(s.ts).toContain(T0 + 999_000)
    expect(s.ts).toContain(T0 + 5_000_000)
  })
})
