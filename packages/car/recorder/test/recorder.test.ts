import { describe, expect, it } from "@effect/vitest"
import { Effect, SubscriptionRef } from "effect"
import { Recorder } from "../src/recorder.ts"
import { TripStore } from "../src/store.ts"
import { advance, eventually, info, makeEnv, makeSource, sample, settle } from "./helpers.ts"

describe("Recorder", () => {
  it.effect("records, merges fresh GPS, seals and finishes", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const store = yield* TripStore
        const src = yield* makeSource
        const id = yield* rec.start({ source: src.source, info, geo: true })
        yield* settle()
        yield* env.geo.emit({ ts: 1000, lat: 52, lon: 21, accuracyM: 5 })
        yield* settle()
        yield* src.emit(sample(2000))
        yield* src.emit(sample(9000)) // fix is 8 s old: not merged
        yield* settle()
        yield* advance(5000)
        const pending = yield* store.readPending(id)
        expect(pending).toHaveLength(2)
        expect(pending[0]).toMatchObject({ lat: 52, lon: 21, gpsAccuracyM: 5 })
        expect(pending[1]!.lat).toBeUndefined()
        yield* rec.stop
        const trip = (yield* store.getTrip(id))!
        expect(trip.manifest.status).toBe("finished")
        expect(trip.manifest.chunkCount).toBe(1)
        expect(trip.manifest.chunks[0]!.rows).toBe(2)
        expect((yield* SubscriptionRef.get(rec.state))._tag).toBe("Idle")
        expect(env.wl.log).toEqual(["acquire", "release"])
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("seals a chunk every 30 s", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const src = yield* makeSource
        yield* rec.start({ source: src.source, info })
        yield* settle()
        yield* src.emit(sample(1))
        yield* advance(5000)
        yield* advance(25000)
        const st = yield* eventually(SubscriptionRef.get(rec.state), (s) => s._tag === "Recording" && s.chunks === 1)
        expect(st._tag === "Recording" && st.chunks).toBe(1)
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("records source gaps and app_backgrounded gaps", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const store = yield* TripStore
        const src = yield* makeSource
        const id = yield* rec.start({ source: src.source, info })
        yield* settle()
        yield* src.emit({ _tag: "GapStarted", at: 100, reason: "adapter_disconnected" })
        yield* src.emit({ _tag: "GapEnded", at: 200 })
        yield* settle()
        yield* env.lifecycle.setVisible(false)
        yield* settle()
        yield* advance(3000)
        yield* env.lifecycle.setVisible(true)
        yield* settle()
        yield* rec.stop
        const gaps = (yield* store.getTrip(id))!.manifest.gaps
        expect(gaps[0]).toEqual({ from: 100, to: 200, reason: "adapter_disconnected" })
        expect(gaps[1]).toMatchObject({ reason: "app_backgrounded", to: 3000 })
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("crash mid-trip: flushed samples survive, trip is offered for continue/finish", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      const id = yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const src = yield* makeSource
        const tripId = yield* rec.start({ source: src.source, info })
        yield* settle()
        yield* src.emit(sample(10))
        yield* src.emit(sample(20))
        yield* advance(5000) // flushed
        yield* src.emit(sample(30)) // never flushed: lost in the crash
        yield* settle()
        return tripId
      }).pipe(Effect.provide(env.layer()))
      // "restart": new layers over the same database
      yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const store = yield* TripStore
        const found = yield* rec.recoverUnfinished
        expect(found).toEqual([{ tripId: id, startedAt: 0, lastSampleAt: 20, points: 2, chunks: 0 }])
        const src = yield* makeSource
        yield* advance(1000)
        yield* rec.resume(id, src.source)
        const gaps = (yield* store.getTrip(id))!.manifest.gaps
        expect(gaps).toEqual([{ from: 20, to: 6000, reason: "app_restarted" }])
        yield* src.emit(sample(1100))
        yield* settle()
        yield* rec.stop
        const trip = (yield* store.getTrip(id))!
        expect(trip.manifest.status).toBe("finished")
        expect(trip.manifest.chunks.reduce((n, c) => n + c.rows, 0)).toBe(3)
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("finishInterrupted closes the trip at the last flushed sample", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      const id = yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const src = yield* makeSource
        const tripId = yield* rec.start({ source: src.source, info })
        yield* settle()
        yield* src.emit(sample(10))
        yield* advance(5000)
        return tripId
      }).pipe(Effect.provide(env.layer()))
      yield* Effect.gen(function*() {
        const rec = yield* Recorder
        yield* rec.finishInterrupted(id)
        const m = (yield* (yield* TripStore).getTrip(id))!.manifest
        expect(m).toMatchObject({ status: "finished", endedAt: 10, chunkCount: 1 })
        expect(yield* rec.recoverUnfinished).toEqual([])
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("a second start while recording fails with busy", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const rec = yield* Recorder
        const src = yield* makeSource
        yield* rec.start({ source: src.source, info })
        const err = yield* rec.start({ source: src.source, info }).pipe(Effect.flip)
        expect(err._tag).toBe("RecorderFailure")
      }).pipe(Effect.provide(env.layer()))
    }))
})
