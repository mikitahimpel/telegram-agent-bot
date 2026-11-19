import { describe, expect, it } from "vitest"
import { buildTrip, cruise, DAY, gen, ingestAll, newEngine, T0 } from "./helpers.ts"

describe("dtc history", () => {
  it("tracks first and last seen, activates and clears codes, drives the check engine alert", () => {
    let now = T0
    const { engine } = newEngine(() => now)
    const e1 = engine.putDtc({ readAt: T0, milOn: true, codes: [{ code: "P0420", kind: "stored" }], tripId: null, vin: null }, "en")
    expect(e1).toHaveLength(1)
    expect(e1[0]).toMatchObject({ code: "P0420", firstSeenAt: T0, lastSeenAt: T0, source: "catalog" })
    expect(engine.pending("en").codes).toHaveLength(1)
    expect(engine.pending("en").alerts.map((a) => a.kind)).toEqual(["check_engine"])
    now = T0 + DAY
    engine.putDtc({ readAt: T0 + DAY, milOn: true, codes: [{ code: "P0420", kind: "stored" }, { code: "P1234", kind: "pending" }], tripId: null, vin: null }, "ru")
    const cur = engine.dtcCurrent("en")
    expect(cur.codes.map((c) => [c.code, c.firstSeenAt, c.lastSeenAt, c.source])).toEqual([
      ["P0420", T0, T0 + DAY, "catalog"],
      ["P1234", T0 + DAY, T0 + DAY, "generic"]
    ])
    expect(engine.alerts("en").filter((a) => a.kind === "check_engine")).toHaveLength(1)
    now = T0 + 2 * DAY
    engine.putDtc({ readAt: T0 + 2 * DAY, milOn: false, codes: [], tripId: null, vin: null }, "en")
    expect(engine.dtcCurrent("en")).toMatchObject({ milOn: false, codes: [] })
    expect(engine.alerts("en")[0]!.resolvedAt).toBe(T0 + 2 * DAY)
    const hist = engine.query("SELECT code, active, first_seen_at, last_seen_at FROM car_dtc_codes ORDER BY code")
    expect(hist.ok && hist.rows).toEqual([["P0420", 0, T0, T0 + DAY], ["P1234", 0, T0 + DAY, T0 + DAY]])
  })

  it("re-notifies a code that returns after being cleared", () => {
    const { engine } = newEngine(() => T0)
    const r = (codes: Array<{ code: string; kind: "stored" }>) => engine.putDtc({ readAt: T0, milOn: codes.length > 0, codes, tripId: null, vin: null }, "en")
    r([{ code: "P0171", kind: "stored" }])
    engine.markNotified([], [{ code: "P0171", kind: "stored" }])
    expect(engine.pending("en").codes).toHaveLength(0)
    r([])
    r([{ code: "P0171", kind: "stored" }])
    expect(engine.pending("en").codes).toHaveLength(1)
  })
})

describe("overview", () => {
  it("aggregates totals, weeks and months, battery and engine state", async () => {
    const { engine } = newEngine(() => T0 + 20 * DAY)
    for (let n = 0; n < 3; n++) {
      const start = T0 + n * 8 * DAY
      const samples = gen(start, 1801, (t) => (t < 10 ? { speedKmh: 0, rpm: 0, voltageV: 12.6 } : { ...cruise(36, { fuelRateLph: 3.6 })(), speedKmh: 36 }))
      ingestAll(engine, await buildTrip(start, samples, { rand: `c${n}cccccc` }))
    }
    const o = engine.overview("en")
    expect(o.totals.trips).toBe(3)
    expect(o.totals.distanceKm).toBeCloseTo(3 * 17.9, 0)
    expect(o.totals.fuelPer100Km).toBeCloseTo(10, 0)
    expect(o.byWeek.length).toBeGreaterThanOrEqual(2)
    expect(o.byMonth[0]!.period).toBe("2026-11")
    expect(o.battery).toMatchObject({ status: "good", lastRestingV: 12.6 })
    expect(o.battery.trend).toHaveLength(3)
    expect(o.engine.milOn).toBe(false)
    expect(o.lastTripAt).not.toBeNull()
  })

  it("compares a trip with the usual consumption", async () => {
    const { engine, sql } = newEngine(() => T0 + 40 * DAY)
    const mk = async (n: number, lph: number) => {
      const start = T0 + n * DAY
      return ingestAll(engine, await buildTrip(start, gen(start, 1801, cruise(60, { fuelRateLph: lph })), { rand: `d${n}dddddd` }))
    }
    for (let n = 0; n < 6; n++) await mk(n, 6)
    await mk(7, 8)
    const id = String(sql.all("SELECT trip_id FROM car_trips ORDER BY started_at DESC LIMIT 1")[0]!["trip_id"])
    const last = engine.tripInsight(id)
    expect(last?.comparedToUsual.fuelPer100KmDeltaPct).toBeCloseTo(33.3, 0)
    expect(engine.alerts("en").some((a) => a.kind === "fuel_consumption_up")).toBe(true)
  })
})
