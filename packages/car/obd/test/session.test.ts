import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream, SubscriptionRef } from "effect"
import { driven } from "./helpers.ts"
import { connect, type ObdEvent } from "../src/session.ts"

const collect = (session: Effect.Success<ReturnType<typeof connect>>, n: number, intervalMs = 1000) =>
  Stream.runCollect(session.readings({ intervalMs }).pipe(Stream.take(n)))

const readings = (events: ReadonlyArray<ObdEvent>) =>
  events.flatMap((e) => (e._tag === "Reading" ? [e.sample] : []))

describe("session (simulator)", () => {
  it.effect("normal: init, info and readings", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const session = yield* connect("simulator", { scenario: "normal" })
          expect(session.info.transport).toBe("simulator")
          expect(session.info.elmVersion).toContain("ELM327")
          expect(session.info.obdProtocol).toBe("ISO 15765-4 CAN (11 bit, 500 kbaud)")
          expect(session.info.vin).toBe("WP0ZZZ99ZTS392124")
          expect(session.info.supportedPids).toContain("5E")
          expect(session.info.fuelRateSource).toBe("pid_5e")
          const st = yield* SubscriptionRef.get(session.state)
          expect(st._tag).toBe("Ready")
          const events = yield* collect(session, 2)
          const [first] = readings(events)
          expect(first).toMatchObject({ speedKmh: 60, rpm: 2000, coolantC: 90, intakeC: 25, mapKpa: 100, fuelRateLph: 5 })
          expect(first?.voltageV).toBeCloseTo(14.1)
          expect(first?.mafGps).toBeCloseTo(12.34)
        })
      )))

  it.effect("ignition_off fails with EcuNotResponding", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const exit = yield* connect("simulator", { scenario: "ignition_off" }).pipe(Effect.flip)
          expect(exit._tag).toBe("EcuNotResponding")
          if (exit._tag === "EcuNotResponding") expect(exit.response).toContain("UNABLE")
        })
      )))

  it.effect("clone_garbage recovers through the alternative init", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const session = yield* connect("simulator", { scenario: "clone_garbage" })
          expect(session.info.elmVersion).toContain("ELM327")
          const events = yield* collect(session, 1)
          expect(readings(events)[0]?.rpm).toBe(2000)
        })
      )))

  it.effect("drops_every_60s: gap events and reconnect", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const session = yield* connect("simulator", { scenario: "drops_every_60s" })
          const events = yield* Stream.runCollect(
            session.readings({ intervalMs: 1000 }).pipe(
              Stream.takeUntil((e) => e._tag === "GapEnded"),
              Stream.take(500)
            )
          )
          const tags = events.map((e) => e._tag)
          expect(tags.at(-1)).toBe("GapEnded")
          expect(tags).toContain("GapStarted")
          const started = events.find((e) => e._tag === "GapStarted")
          expect(started).toMatchObject({ reason: "adapter_disconnected" })
          const st = yield* SubscriptionRef.get(session.state)
          expect(st._tag).toBe("Ready")
        }),
        100
      )))

  it.effect("unsupported PID stays undefined", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const session = yield* connect("simulator", { scenario: "normal", unsupported: ["0F"] })
          expect(session.info.supportedPids).not.toContain("0F")
          const [s] = readings(yield* collect(session, 1))
          expect(s?.intakeC).toBeUndefined()
          expect("intakeC" in (s ?? {})).toBe(false)
          expect(s?.coolantC).toBe(90)
        })
      )))

  it.effect("no_fuel_pid: fuel rate is estimated from MAF", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const session = yield* connect("simulator", { scenario: "no_fuel_pid" })
          expect(session.info.fuelRateSource).toBe("maf_estimate")
          const [s] = readings(yield* collect(session, 1))
          expect(s?.fuelRateLph).toBeCloseTo((12.34 / 14.7 / 0.745 / 1000) * 3600, 6)
        })
      )))

  it.effect("slow_ecu still produces readings", () =>
    Effect.scoped(
      driven(
        Effect.gen(function*() {
          const session = yield* connect("simulator", { scenario: "slow_ecu" })
          const events = yield* collect(session, 2)
          expect(readings(events)).toHaveLength(2)
        })
      )))
})
