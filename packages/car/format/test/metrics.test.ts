import { describe, expect, it } from "vitest"
import { distanceStep, haversineKm } from "../src/metrics.ts"

describe("distanceStep", () => {
  it("integrates OBD speed and ignores long steps and gaps", () => {
    expect(distanceStep({ ts: 0, speedKmh: 36 }, { ts: 5000, speedKmh: 36 })?.obdKm).toBeCloseTo(0.05)
    expect(distanceStep({ ts: 0, speedKmh: 36 }, { ts: 11_000, speedKmh: 36 })).toBeUndefined()
    expect(distanceStep({ ts: 0, speedKmh: 36 }, { ts: 5000, speedKmh: 36 }, [{ from: 1000, to: 2000, reason: "unknown" }])).toBeUndefined()
  })
  it("falls back to GPS", () => {
    const d = distanceStep({ ts: 0, lat: 52, lon: 21 }, { ts: 10_000, lat: 52.001, lon: 21 })
    expect(d?.obdKm).toBeUndefined()
    expect(d?.gpsKm).toBeCloseTo(haversineKm(52, 21, 52.001, 21))
  })
})
