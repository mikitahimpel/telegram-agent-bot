import { describe, expect, it } from "vitest"
import { evaluateDtc, evaluateTrip } from "../src/alerts.ts"
import { computeTrip } from "../src/insight.ts"
import { renderAlert } from "../src/render.ts"
import { buildTrip, cruise, DAY, gen, ingestAll, newEngine, T0 } from "./helpers.ts"

const withStart = (restingV: number, crankV: number, run: Parameters<typeof cruise>[1] = {}) =>
  gen(T0, 600, (t) => {
    if (t < 20) return { speedKmh: 0, rpm: 0, voltageV: restingV }
    if (t === 20) return { speedKmh: 0, rpm: 600, voltageV: crankV }
    return { ...cruise(50, run)(), speedKmh: 50 }
  })

const day = (n: number) => T0 + n * DAY

describe("alert rules", () => {
  it("raises battery watch and weak with evidence", () => {
    const run = (r: number, c: number) => {
      const { insight, extras } = computeTrip({ tripId: "t", startedAt: T0, endedAt: T0, complete: true, gaps: [], samples: withStart(r, c) })
      return evaluateTrip(insight, extras, { medianPer100Km: null, trips: 0 }).filter((f) => f.kind === "battery_weak")[0]
    }
    expect(run(12.3, 10.5)).toMatchObject({ status: "raise", severity: "watch" })
    expect(run(12.1, 10.5)).toMatchObject({ status: "raise", severity: "soon" })
    expect(run(12.6, 9.5)).toMatchObject({ status: "raise", severity: "soon" })
    expect(run(12.6, 10.5)).toMatchObject({ status: "clear" })
    expect(run(12.45, 10.5)).toBeUndefined()
  })

  it("evaluates charging, overheating and low fuel", () => {
    const f = (extra: Parameters<typeof cruise>[1]) => {
      const { insight, extras } = computeTrip({ tripId: "t", startedAt: T0, endedAt: T0, complete: true, gaps: [], samples: gen(T0, 600, cruise(50, extra)) })
      return evaluateTrip(insight, extras, { medianPer100Km: null, trips: 0 })
    }
    expect(f({ voltageV: 12.9 }).find((x) => x.key === "charging_problem:low")?.status).toBe("raise")
    expect(f({ voltageV: 15.1 }).find((x) => x.key === "charging_problem:high")).toMatchObject({ status: "raise", severity: "urgent" })
    expect(f({ voltageV: 14.1 }).find((x) => x.key === "charging_problem:low")?.status).toBe("clear")
    expect(f({ coolantC: 108 }).find((x) => x.kind === "overheating")).toMatchObject({ status: "raise", severity: "urgent" })
    expect(f({ fuelLevelPct: 8 }).find((x) => x.kind === "low_fuel")?.status).toBe("raise")
    expect(f({ fuelLevelPct: 60 }).find((x) => x.kind === "low_fuel")?.status).toBe("clear")
  })

  it("flags slow warm-up only on a cold start", () => {
    const slow = gen(T0, 1500, (t) => ({ speedKmh: 40, rpm: 1500, coolantC: 15 + t * 0.03 }))
    const { insight, extras } = computeTrip({ tripId: "t", startedAt: T0, endedAt: T0, complete: true, gaps: [], samples: slow })
    expect(evaluateTrip(insight, extras, { medianPer100Km: null, trips: 0 }).find((x) => x.kind === "slow_warmup")?.status).toBe("raise")
    const warm = computeTrip({ tripId: "t", startedAt: T0, endedAt: T0, complete: true, gaps: [], samples: gen(T0, 1500, cruise(40)) })
    expect(evaluateTrip(warm.insight, warm.extras, { medianPer100Km: null, trips: 0 }).find((x) => x.kind === "slow_warmup")).toBeUndefined()
  })

  it("raises fuel consumption up only above 15 percent with enough baseline", () => {
    const { insight, extras } = computeTrip({ tripId: "t", startedAt: T0, endedAt: T0, complete: true, gaps: [], samples: gen(T0, 1800, cruise(60, { fuelRateLph: 7 })) })
    expect(insight.fuelPer100Km).toBeCloseTo(11.67, 1)
    const at = (median: number, trips: number) => evaluateTrip(insight, extras, { medianPer100Km: median, trips }).find((x) => x.kind === "fuel_consumption_up")
    expect(at(10, 6)).toMatchObject({ status: "raise" })
    expect(at(10.5, 6)?.status).toBe(undefined)
    expect(at(11.5, 6)?.status).toBe("clear")
    expect(at(8, 2)).toBeUndefined()
  })

  it("derives check engine severity from the codes", () => {
    expect(evaluateDtc({ milOn: true, tripId: null }, [{ code: "P0300", severity: "urgent" }])[0]).toMatchObject({ status: "raise", severity: "urgent" })
    expect(evaluateDtc({ milOn: true, tripId: null }, [])[0]).toMatchObject({ status: "raise", severity: "soon" })
    expect(evaluateDtc({ milOn: false, tripId: null }, [])[0]?.status).toBe("clear")
  })
})

describe("alert lifecycle", () => {
  it("deduplicates, escalates and resolves a battery alert across trips", async () => {
    const { engine } = newEngine(() => day(9))
    const mk = async (n: number, r: number, c: number) => ingestAll(engine, await buildTrip(day(n), withStart(r, c).map((s) => ({ ...s, ts: s.ts + n * DAY })), { rand: `a${n}aaaaaa` }))
    await mk(1, 12.3, 10.5)
    await mk(2, 12.3, 10.4)
    let open = engine.alerts("en").filter((a) => a.resolvedAt === null)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ kind: "battery_weak", severity: "watch" })
    expect(open[0]!.details).toContain("12.30 V")
    expect(open[0]!.title.length).toBeGreaterThan(5)
    expect(open[0]!.whatToDo.length).toBeGreaterThan(20)
    expect(engine.pending("en").alerts).toHaveLength(1)
    engine.markNotified(open.map((a) => a.id), [])
    await mk(3, 12.1, 10.4)
    open = engine.alerts("ru").filter((a) => a.resolvedAt === null)
    expect(open).toHaveLength(1)
    expect(open[0]!.severity).toBe("soon")
    expect(open[0]!.title).toMatch(/Аккумулятор/)
    expect(engine.pending("en").alerts).toHaveLength(1)
    await mk(4, 12.7, 10.8)
    expect(engine.alerts("en").filter((a) => a.resolvedAt === null)).toHaveLength(0)
    expect(engine.alerts("en")).toHaveLength(1)
    expect(engine.pending("en").alerts).toHaveLength(0)
  })

  it("does not let an older late-arriving trip change alert state", async () => {
    const { engine } = newEngine(() => day(9))
    const shift = (n: number, s: ReturnType<typeof withStart>) => s.map((x) => ({ ...x, ts: x.ts + n * DAY }))
    ingestAll(engine, await buildTrip(day(5), shift(5, withStart(12.7, 10.8)), { rand: "bbbbbbb5" }))
    ingestAll(engine, await buildTrip(day(2), shift(2, withStart(12.0, 10.0)), { rand: "bbbbbbb2" }))
    expect(engine.alerts("en")).toHaveLength(0)
  })

  it("renders every alert key in both languages", () => {
    for (const key of ["battery_weak", "charging_problem:low", "charging_problem:high", "overheating", "slow_warmup", "fuel_consumption_up", "low_fuel", "check_engine"]) {
      for (const lang of ["en", "ru"] as const) {
        const r = renderAlert(key, "watch", { restingV: 12.3, chargingAvgV: 13, maxCoolantC: 110, warmupS: 1000, startCoolantC: 10, fuelPer100Km: 9, medianPer100Km: 7, deltaPct: 28, fuelLevelPct: 5, milOn: 1, codes: 1 }, lang, "P0420")
        expect(r.title).not.toBe("")
        expect(r.details).not.toBe("")
        expect(r.whatToDo).not.toBe("")
      }
    }
  })
})
