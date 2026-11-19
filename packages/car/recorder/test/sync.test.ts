import { describe, expect, it } from "@effect/vitest"
import { Effect, SubscriptionRef } from "effect"
import { CarApi } from "../src/api-client.ts"
import { TripStore } from "../src/store.ts"
import { SyncEngine, type SyncState, type TripSyncInfo } from "../src/sync.ts"
import { advance, apiError, eventually, makeEnv, pump, seedTrip } from "./helpers.ts"

const getState = SyncEngine.use((s) => SubscriptionRef.get(s.state))
const trip = (s: SyncState, id: string): TripSyncInfo | undefined => s.trips.find((t) => t.tripId === id)
const tripTag = (id: string) => Effect.map(getState, (s) => trip(s, id)?.sync._tag)

describe("SyncEngine", () => {
  it.effect("uploads manifest, chunks, finishes and confirms", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(3)
        yield* advance(0)
        yield* eventually(tripTag(id), (t) => t === "Confirmed")
        const s = yield* getState
        expect(trip(s, id)!.sync._tag).toBe("Confirmed")
        expect(trip(s, id)!.chunks.map((c) => c.state)).toEqual(["confirmed", "confirmed", "confirmed"])
        expect(s.status._tag).toBe("Idle")
        expect(env.server.count("PUT /trips")).toBeGreaterThanOrEqual(4)
        const order = env.server.log.map((r) => r.method + " " + r.path.split("/").slice(3).join("/"))
        expect(order.findIndex((o) => o.startsWith("PUT") && o.includes("manifest"))).toBeLessThan(order.findIndex((o) => o.includes("chunks")))
        expect(env.server.log.find((r) => r.path.includes("chunks"))!.auth).toBe("Device tok-1")
        expect(env.server.log.find((r) => r.path.includes("chunks"))!.sha).toMatch(/^[0-9a-f]{64}$/)
        expect((yield* (yield* TripStore).getTrip(id))!.confirmedAt).toBeDefined()
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("partial upload with 5xx backs off visibly, then completes", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.server.hook = (r) => (r.path.endsWith("/chunks/1") ? apiError(503, "internal", true) : undefined)
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(3)
        const s1 = yield* eventually(getState, (s) => trip(s, id)?.sync._tag === "Waiting")
        const w = trip(s1, id)!
        expect(w.sync).toMatchObject({ _tag: "Waiting", sent: 2, total: 3 })
        expect(w.sync._tag === "Waiting" && w.sync.nextRetryAt).toBeGreaterThan(0)
        expect(w.chunks.map((c) => c.state)).toEqual(["sent", "waiting", "sent"])
        env.server.hook = undefined
        yield* advance(10_000)
        yield* eventually(tripTag(id), (t) => t === "Confirmed")
        expect(yield* tripTag(id)).toBe("Confirmed")
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("offline queues everything; reconnect (online event) uploads", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* env.lifecycle.setOnline(false)
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(2)
        yield* advance(0)
        const off = yield* eventually(getState, (s) => s.status._tag === "Offline")
        expect(off.status._tag).toBe("Offline")
        expect(trip(off, id)!.sync._tag).toBe("Queued")
        expect(env.server.log).toHaveLength(0)
        yield* env.lifecycle.setOnline(true)
        yield* eventually(tripTag(id), (t) => t === "Confirmed")
        expect(yield* tripTag(id)).toBe("Confirmed")
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("checksum_mismatch retries, then marks the chunk Corrupt after 3", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      let fails = 0
      env.server.hook = (r) => (r.path.endsWith("/chunks/0") && fails++ < 2 ? apiError(400, "checksum_mismatch", true) : undefined)
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(1)
        yield* pump(tripTag(id), (t) => t === "Confirmed")
        expect(yield* tripTag(id)).toBe("Confirmed")
        expect(env.server.count("PUT /trips/" + id + "/chunks/0")).toBe(3)
      }).pipe(Effect.provide(env.layer()))

      const env2 = yield* makeEnv
      env2.server.hook = (r) => (r.path.includes("/chunks/") ? apiError(400, "checksum_mismatch", true) : undefined)
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(1)
        const s = yield* pump(getState, (x) => trip(x, id)?.sync._tag === "Incomplete")
        expect(trip(s, id)!.chunks[0]!.state).toBe("corrupt")
        expect(trip(s, id)!.sync).toMatchObject({ _tag: "Incomplete", corrupt: 1, localCopy: true })
        expect(env2.server.count("PUT /trips/" + id + "/chunks/0")).toBe(3)
      }).pipe(Effect.provide(env2.layer()))
    }))

  it.effect("chunk_conflict is never retried automatically", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.server.hook = (r) => (r.path.endsWith("/chunks/1") ? apiError(409, "chunk_conflict", false) : undefined)
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(3)
        const s = yield* eventually(getState, (x) => trip(x, id)?.sync._tag === "Incomplete")
        expect(trip(s, id)!.chunks.map((c) => c.state)).toEqual(["sent", "conflict", "sent"])
        expect(trip(s, id)!.sync).toMatchObject({ _tag: "Incomplete", conflict: 1 })
        yield* advance(3_600_000)
        yield* advance(3_600_000)
        expect(env.server.count("PUT /trips/" + id + "/chunks/1")).toBe(1)
        expect((yield* (yield* TripStore).getTrip(id))!.confirmedAt).toBeUndefined()
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("revoked device pauses sync, keeps data; re-pairing resumes the pending chunks", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.server.validTokens = new Set()
      yield* Effect.gen(function*() {
        const sync = yield* SyncEngine
        const api = yield* CarApi
        const id = yield* seedTrip(2)
        const s = yield* eventually(getState, (x) => x.status._tag === "NeedsReauth")
        expect(s.status).toMatchObject({ _tag: "NeedsReauth", reason: "device_revoked" })
        const calls = env.server.log.length
        yield* advance(600_000)
        expect(env.server.log.length).toBe(calls)
        expect((yield* (yield* TripStore).listChunks(id)).length).toBe(2)
        const paired = yield* api.pairComplete("code", "Pixel")
        expect(env.server.log.at(-1)!.auth).toBeUndefined()
        env.server.validTokens = new Set([paired.deviceToken])
        yield* api.setCredential({ token: paired.deviceToken })
        yield* sync.retryNow()
        yield* eventually(tripTag(id), (t) => t === "Confirmed")
        expect(yield* tripTag(id)).toBe("Confirmed")
        expect((yield* getState).status._tag).toBe("Idle")
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("without a credential sync stays NeedsReauth{not_paired} and local data is untouched", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(1)
        const s = yield* eventually(getState, (x) => x.status._tag === "NeedsReauth")
        expect(s.status).toMatchObject({ reason: "not_paired" })
        expect(env.server.log).toHaveLength(0)
        expect(yield* eventually(tripTag(id), (t) => t === "Queued")).toBe("Queued")
      }).pipe(Effect.provide(env.layer(null)))
    }))

  it.effect("plugin_disabled / forbidden pause with Blocked", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.server.hook = (r) => (r.path.includes("/trips/") ? apiError(403, "plugin_disabled", false) : undefined)
      yield* Effect.gen(function*() {
        yield* seedTrip(1)
        const s = yield* eventually(getState, (x) => x.status._tag === "Blocked")
        expect(s.status).toMatchObject({ _tag: "Blocked", code: "plugin_disabled" })
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("server lost a chunk after upload: reconciliation re-sends it from local data", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      let dropped = false
      env.server.hook = (r) => {
        if (r.method === "POST" && r.path.endsWith("/finish") && !dropped) {
          dropped = true
          const id = r.path.split("/")[2]!
          env.server.chunks.get(id)!.delete(1)
        }
        return undefined
      }
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(3)
        yield* eventually(tripTag(id), (t) => t === "Confirmed")
        expect(yield* tripTag(id)).toBe("Confirmed")
        expect(env.server.count("PUT /trips/" + id + "/chunks/1")).toBe(2)
        expect(env.server.count("PUT /trips/" + id + "/chunks/0")).toBe(1)
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("unknown server trips show as CloudOnly; clock offset is exposed", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.server.serverTime = -300_000
      env.server.trips = [{ tripId: "20260101T000000Z-aaaaaaaa", startedAt: 5, endedAt: 9, status: "finished", chunkCount: 2, received: 2, complete: true }]
      yield* Effect.gen(function*() {
        const s = yield* eventually(getState, (x) => x.trips.length > 0)
        expect(s.trips[0]!.sync._tag).toBe("CloudOnly")
        expect(s.clockOffsetMs).toBe(300_000)
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("deletes confirmed trips after 7 days, never unconfirmed ones", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      yield* Effect.gen(function*() {
        const store = yield* TripStore
        const done = yield* seedTrip(1, { at: 10_000 })
        yield* eventually(tripTag(done), (t) => t === "Confirmed")
        env.server.hook = () => "network"
        const stuck = yield* seedTrip(1, { at: 20_000 })
        yield* advance(8 * 24 * 3600_000)
        yield* (yield* SyncEngine).retryNow()
        yield* advance(1000)
        expect(yield* store.getTrip(done)).toBeUndefined()
        expect(yield* store.getTrip(stuck)).toBeDefined()
        expect((yield* store.listChunks(stuck)).length).toBe(1)
      }).pipe(Effect.provide(env.layer()))
    }))

  it.effect("discardLocal on an unconfirmed trip reports Incomplete without a local copy", () =>
    Effect.gen(function*() {
      const env = yield* makeEnv
      env.server.hook = () => "network"
      yield* Effect.gen(function*() {
        const id = yield* seedTrip(2)
        yield* advance(0)
        yield* (yield* SyncEngine).discardLocal(id)
        const s = yield* getState
        expect(trip(s, id)!.sync).toMatchObject({ _tag: "Incomplete", localCopy: false })
      }).pipe(Effect.provide(env.layer()))
    }))
})
