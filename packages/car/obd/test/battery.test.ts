import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { makeBatteryTracker } from "../src/battery.ts"
import { connect, type WatchTick } from "../src/session.ts"
import { crankingScript, makeSimCar } from "../src/simulator.ts"
import { driven } from "./helpers.ts"

describe("battery tracker", () => {
  it("captures resting, cranking minimum and charging", () => {
    const t = makeBatteryTracker()
    for (let i = 0; i < 20; i++) {
      t.rpm(i * 500, 0)
      t.voltage(i * 500, 12.6)
    }
    const crank = [11.2, 9.8, 10.4, 9.6, 10.9]
    crank.forEach((v, i) => {
      t.voltage(10_000 + i * 200, v)
      t.rpm(10_000 + i * 200, 220)
    })
    const started = t.rpm(11_500, 900)
    expect(started).toEqual([
      expect.objectContaining({ _tag: "Resting", volts: 12.6 }),
      expect.objectContaining({ _tag: "Cranking", minV: 9.6, restingV: 12.6 })
    ])
    for (let s = 12; s <= 50; s += 2) t.voltage(s * 1000, 14.2)
    const report = t.report()
    expect(report).toMatchObject({ restingV: 12.6, crankMinV: 9.6, chargingV: 14.2, chargingSamples: expect.any(Number) })
  })

  it("does not report cranking without a prior off observation", () => {
    const t = makeBatteryTracker()
    t.voltage(0, 14.1)
    expect(t.rpm(1000, 2000)).toEqual([])
    expect(t.report()).toEqual({})
  })

  it("ignores a shallow dip", () => {
    const t = makeBatteryTracker()
    for (let i = 0; i < 12; i++) {
      t.rpm(i * 1000, 0)
      t.voltage(i * 1000, 12.6)
    }
    const events = t.rpm(12_000, 900)
    expect(events.map((e) => e._tag)).toEqual(["Resting"])
  })
})

describe("session watch (simulator)", () => {
  it.effect("waitForEcu: ignition off then on, cranking captured through watch", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const car = makeSimCar({ ignition: false, rpm: 0, voltageV: 12.5 })
          const session = yield* connect("simulator", { scenario: "normal", car, waitForEcu: true })
          expect(session.ecuIdentified).toBe(false)
          const tracker = makeBatteryTracker()
          yield* Effect.forkScoped(Effect.sleep("3 seconds").pipe(Effect.andThen(crankingScript(car, { idleMs: 3000 }))))
          const ticks: Array<WatchTick> = []
          yield* session.watch({ intervalMs: 500 }).pipe(
            Stream.runForEach((tick) =>
              Effect.sync(() => {
                ticks.push(tick)
                for (const v of tick.voltages) tracker.voltage(v.ts, v.volts)
                tracker.rpm(tick.ts, tick.rpm)
              })
            ),
            Effect.timeoutOption("20 seconds")
          )
          expect(session.ecuIdentified).toBe(true)
          expect(session.info.vin).toBe("WP0ZZZ99ZTS392124")
          expect(ticks.some((t) => !t.ecuResponding)).toBe(true)
          expect(ticks.at(-1)?.rpm).toBe(900)
          const r = tracker.report()
          expect(r.restingV).toBeCloseTo(12.5, 1)
          expect(r.crankMinV).toBeLessThanOrEqual(10.5)
        }),
        100
      )))
})
