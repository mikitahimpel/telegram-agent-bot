import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { crankingScript, makeSimCar } from "@bot/car-obd/transport"
import { ReconnectUnavailable } from "@bot/car-obd/errors"
import { AutoRecorder, type AutoState } from "../src/auto.ts"
import { TripStore } from "../src/store.ts"
import { SyncEngine } from "../src/sync.ts"
import { makeEnv, settle } from "./helpers.ts"

const run = (ms: number, step = 250) =>
  Effect.gen(function*() {
    for (let t = 0; t < ms; t += step) {
      yield* TestClock.adjust(step)
      yield* settle(2)
    }
  })

const runUntil = <A, R>(read: Effect.Effect<A, never, R>, ok: (a: A) => boolean, maxMs = 120_000, step = 250) =>
  Effect.gen(function*() {
    let last = yield* read
    for (let t = 0; t < maxMs && !ok(last); t += step) {
      yield* TestClock.adjust(step)
      yield* settle(2)
      last = yield* read
    }
    return last
  })

const stateTag = AutoRecorder.use((a) => SubscriptionRef.get(a.state))
const tagIs = (...tags: ReadonlyArray<AutoState["_tag"]>) => (s: AutoState) => tags.includes(s._tag)

describe("AutoRecorder", () => {
  it.effect("waits for ignition, captures cranking, auto-starts, auto-stops, scans twice", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      const car = makeSimCar({ ignition: false, rpm: 0, voltageV: 12.5 })
      env.connector.control.car = car
      yield* Effect.gen(function*() {
        const auto = yield* AutoRecorder
        const store = yield* TripStore
        yield* auto.enable({ geo: false })
        const ecu = yield* runUntil(stateTag, tagIs("EcuNotResponding"), 30_000)
        expect(ecu._tag).toBe("EcuNotResponding")
        expect(env.wl.log).toContain("hold")

        yield* Effect.forkChild(crankingScript(car, { idleMs: 3000 }))
        car.ignition = true
        const rec = yield* runUntil(stateTag, tagIs("Recording"), 60_000)
        expect(rec._tag).toBe("Recording")
        if (rec._tag !== "Recording") return
        expect(rec.trigger).toBe("auto")
        yield* run(5000)
        const battery = yield* SubscriptionRef.get(auto.battery)
        expect(battery.restingV).toBeCloseTo(12.6, 0)
        expect(battery.crankMinV).toBeLessThan(11)
        const mid = (yield* store.getTrip(rec.tripId))!
        expect(mid.manifest.trigger).toBe("auto")
        expect(mid.manifest.battery?.crankMinV).toBeLessThan(11)

        car.rpm = 0
        const stopped = yield* runUntil(stateTag, tagIs("AutoStopped"), 120_000)
        expect(stopped).toMatchObject({ _tag: "AutoStopped", reason: "engine_off", tripId: rec.tripId })
        yield* run(3000)
        const trip = (yield* store.getTrip(rec.tripId))!
        expect(trip.manifest.status).toBe("finished")
        expect(trip.manifest.endReason).toBe("engine_off")
        const dtc = yield* store.listDtc
        expect(dtc.length).toBe(2)
        expect(dtc.every((r) => r.report.tripId === rec.tripId)).toBe(true)
        expect(dtc[0]!.report.vin).toBe("WP0ZZZ99ZTS392124")
        yield* auto.disable
      }).pipe(Effect.provide(env.layer()))
    }), 60_000)

  it.effect("DTC reports queue offline and are delivered later", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.connector.control.car = makeSimCar({ rpm: 0, ecus: [{ stored: ["P0301"], pending: [], permanent: [], mil: true }] })
      yield* env.lifecycle.setOnline(false)
      yield* Effect.gen(function*() {
        const auto = yield* AutoRecorder
        const sync = yield* SyncEngine
        const store = yield* TripStore
        yield* auto.enable()
        yield* runUntil(stateTag, tagIs("WaitingForEngine"), 30_000)
        const scanning = yield* Effect.forkChild(auto.scanNow)
        yield* run(3000)
        const report = yield* Fiber.join(scanning)
        expect(report.milOn).toBe(true)
        expect(report.codes.map((c) => c.code)).toContain("P0301")
        yield* run(1000)
        expect(env.server.dtc).toHaveLength(0)
        expect((yield* store.listDtc)[0]!.uploadState).toBe("pending")
        expect((yield* SubscriptionRef.get(sync.state)).dtc[0]?.sync._tag).toBe("Queued")
        yield* env.lifecycle.setOnline(true)
        yield* run(3000)
        expect(env.server.dtc).toHaveLength(1)
        expect((yield* store.listDtc)[0]!.uploadState).toBe("confirmed")
        expect((yield* SubscriptionRef.get(sync.state)).dtc[0]?.sync._tag).toBe("Confirmed")
        yield* auto.disable
      }).pipe(Effect.provide(env.layer()))
    }), 60_000)

  it.effect("manual start and stop keep working and never auto-stop", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.connector.control.car = makeSimCar({ rpm: 0 })
      yield* Effect.gen(function*() {
        const auto = yield* AutoRecorder
        const store = yield* TripStore
        yield* auto.enable()
        yield* runUntil(stateTag, tagIs("WaitingForEngine"), 30_000)
        const fiber = yield* Effect.forkChild(auto.startNow)
        yield* run(2000)
        const tripId = yield* Fiber.join(fiber)
        yield* run(70_000, 1000)
        expect((yield* stateTag)._tag).toBe("Recording")
        const stopFiber = yield* Effect.forkChild(auto.stopNow)
        yield* run(2000)
        yield* Fiber.join(stopFiber)
        const trip = (yield* store.getTrip(tripId))!
        expect(trip.manifest).toMatchObject({ status: "finished", trigger: "manual", endReason: "manual" })
        yield* auto.disable
      }).pipe(Effect.provide(env.layer()))
    }), 60_000)

  it.effect("reconnect: adapter out of range, then found", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.connector.control.silentFailure = (n) => (n < 3 ? new ReconnectUnavailable({ reason: "out_of_range" }) : undefined)
      yield* Effect.gen(function*() {
        const auto = yield* AutoRecorder
        yield* auto.enable({ retryBaseMs: 1000 })
        const first = yield* runUntil(stateTag, tagIs("AdapterNotFound"), 5000)
        expect(first._tag).toBe("AdapterNotFound")
        const ok = yield* runUntil(stateTag, tagIs("WaitingForEngine", "EcuNotResponding"), 30_000)
        expect(["WaitingForEngine", "EcuNotResponding"]).toContain(ok._tag)
        expect(env.connector.control.silentAttempts).toBe(3)
        yield* auto.disable
      }).pipe(Effect.provide(env.layer()))
    }), 60_000)

  it.effect("fallback: needs one tap when gestures are required, then connects", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.connector.control.silentFailure = () => new ReconnectUnavailable({ reason: "gesture_required" })
      yield* Effect.gen(function*() {
        const auto = yield* AutoRecorder
        yield* auto.enable()
        const s = yield* runUntil(stateTag, tagIs("NeedsTap"), 5000)
        expect(s).toMatchObject({ _tag: "NeedsTap", reason: "gesture_required" })
        yield* auto.connectNew
        const ok = yield* runUntil(stateTag, tagIs("WaitingForEngine", "EcuNotResponding"), 30_000)
        expect(["WaitingForEngine", "EcuNotResponding"]).toContain(ok._tag)
        expect(env.connector.control.picks).toBe(1)
        yield* auto.disable
      }).pipe(Effect.provide(env.layer()))
    }), 60_000)

  it.effect("fallback: no getDevices support means NeedsTap(unsupported); first use means NeedsTap(first_use)", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.connector.control.support = { ble: true, getDevices: false, watchAdvertisements: false }
      yield* Effect.gen(function*() {
        const auto = yield* AutoRecorder
        yield* auto.enable()
        const s = yield* runUntil(stateTag, tagIs("NeedsTap"), 5000)
        expect(s).toMatchObject({ _tag: "NeedsTap", reason: "unsupported" })
        yield* auto.disable
        env.memory.box.value = undefined
        yield* auto.enable()
        const s2 = yield* runUntil(stateTag, tagIs("NeedsTap"), 5000)
        expect(s2).toMatchObject({ _tag: "NeedsTap", reason: "first_use" })
        yield* auto.disable
      }).pipe(Effect.provide(env.layer()))
    }), 60_000)
})
