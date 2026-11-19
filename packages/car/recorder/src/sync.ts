import { Clock, Context, Data, Duration, Effect, Layer, Queue, Random, Ref, Stream, SubscriptionRef } from "effect"
import type { TripStatus, TripSummary } from "@bot/car-format/api"

type TripSummaryT = typeof TripSummary.Type
import { CarApi } from "./api-client.ts"
import { ApiFailure, type StorageFailure } from "./errors.ts"
import { AppLifecycle } from "./platform.ts"
import { TripStore, type ChunkRecord, type TripRecord } from "./store.ts"

export type ReauthReason = "device_revoked" | "not_paired"
export type BlockedCode = "plugin_disabled" | "forbidden"

/** Global engine status. */
export type SyncStatus = Data.TaggedEnum<{
  Idle: {}
  Syncing: {}
  /** navigator.onLine is false; uploads resume on the `online` event. */
  Offline: {}
  /** 401: device token revoked, or no credential (not paired). Local data is kept; call `retryNow()` after re-pairing. */
  NeedsReauth: { readonly reason: ReauthReason }
  /** 403 / plugin disabled: ask the admin. */
  Blocked: { readonly code: BlockedCode }
  /** The user paused syncing. */
  Paused: {}
}>
export const SyncStatus = Data.taggedEnum<SyncStatus>()

/** Per-trip upload state shown to the user. */
export type TripSync = Data.TaggedEnum<{
  Recording: { readonly sent: number; readonly total: number }
  Queued: { readonly total: number }
  Uploading: { readonly sent: number; readonly total: number; readonly confirmed: number }
  Waiting: {
    readonly sent: number
    readonly total: number
    readonly nextRetryAt: number | undefined
    readonly lastError: string
  }
  Verifying: {}
  Confirmed: { readonly at: number }
  /** Terminal problems: the server cannot get a complete, intact copy without user action (export). */
  Incomplete: {
    readonly missing: number
    readonly corrupt: number
    readonly conflict: number
    readonly localCopy: boolean
  }
  /** Known to the server only (recorded on another device or local copy deleted). */
  CloudOnly: {}
}>
export const TripSync = Data.taggedEnum<TripSync>()

export type ChunkViewState = "pending" | "uploading" | "waiting" | "sent" | "confirmed" | "conflict" | "corrupt" | "lost"

export interface ChunkView {
  readonly seq: number
  readonly rows: number
  readonly state: ChunkViewState
  readonly attempts: number
  readonly nextRetryAt: number | undefined
  readonly lastError: string | undefined
}

export interface TripSyncInfo {
  readonly tripId: string
  readonly startedAt: number
  readonly endedAt: number | undefined
  readonly points: number | undefined
  /** Locally integrated distance; undefined for cloud-only or pre-tracking trips. */
  readonly distanceKm: number | undefined
  readonly sync: TripSync
  readonly chunks: ReadonlyArray<ChunkView>
  /** Server-side counters when known (from GET /trips). */
  readonly cloud: { readonly received: number; readonly chunkCount: number; readonly complete: boolean } | undefined
}

export interface SyncState {
  readonly status: SyncStatus
  readonly trips: ReadonlyArray<TripSyncInfo>
  /** device clock minus server clock, from GET /me. */
  readonly clockOffsetMs: number | undefined
  readonly lastSyncAt: number | undefined
  readonly lastError: string | undefined
}

export interface SyncEngineShape {
  readonly state: SubscriptionRef.SubscriptionRef<SyncState>
  /** Wake up now; with a trip id also clears its backoff and re-queues corrupt chunks. Clears NeedsReauth/Blocked. */
  readonly retryNow: (tripId?: string) => Effect.Effect<void>
  readonly pause: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
  /** User action: drop the local chunks of a trip (a confirmed trip is removed entirely). */
  readonly discardLocal: (tripId: string) => Effect.Effect<void, StorageFailure>
  /** Rebuild state from the store (e.g. after the UI deleted something). */
  readonly refresh: Effect.Effect<void, StorageFailure>
}

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineShape>()("@bot/car-recorder/SyncEngine") {}

export const CHUNK_CONCURRENCY = 2
export const BACKOFF_BASE_MS = 2_000
export const BACKOFF_CAP_MS = 5 * 60_000
export const CHECKSUM_RETRIES = 3
export const RECONCILE_ROUNDS = 3
export const LOCAL_RETENTION_MS = 7 * 24 * 3600_000

class Halt extends Data.TaggedError("Halt")<{ readonly status: SyncStatus }> {}

interface Gate {
  attempts: number
  nextAt: number
  lastError: string
  /** checksum_mismatch counter (chunks only) */
  checksumFails: number
}

export const backoffDelayMs = (attempts: number, jitter: number): number =>
  Math.round(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1)) * (0.5 + 0.5 * jitter))

export const layer: Layer.Layer<SyncEngine, never, TripStore | CarApi | AppLifecycle> = Layer.effect(
  SyncEngine,
  Effect.gen(function*() {
    const store = yield* TripStore
    const api = yield* CarApi
    const lifecycle = yield* AppLifecycle

    const state = yield* SubscriptionRef.make<SyncState>({
      status: SyncStatus.Idle(),
      trips: [],
      clockOffsetMs: undefined,
      lastSyncAt: undefined,
      lastError: undefined
    })
    const wake = yield* Queue.dropping<void>(1)
    const kick = Queue.offer(wake, undefined).pipe(Effect.asVoid)

    const chunkGates = new Map<string, Gate>()
    const tripGates = new Map<string, Gate>()
    const inflight = new Set<string>()
    const verifying = new Set<string>()
    const rounds = new Map<string, number>()
    const manifestFails = new Map<string, number>()
    let cloudTrips: ReadonlyArray<TripSummaryT> = []
    let halt: SyncStatus | undefined
    let paused = false
    let startupDone = false
    let startupGate: Gate | undefined
    let refreshCloud = false
    const key = (tripId: string, seq: number) => `${tripId}:${seq}`

    // ---- state derivation -------------------------------------------------

    const derive = (trip: TripRecord, chunks: ReadonlyArray<ChunkRecord>, now: number): TripSyncInfo => {
      const m = trip.manifest
      const total = m.status === "finished" ? Math.max(m.chunkCount, m.chunks.length) : m.chunks.length
      const bySeq = new Map(chunks.map((c) => [c.seq, c]))
      const views: Array<ChunkView> = []
      for (let seq = 0; seq < total; seq++) {
        const c = bySeq.get(seq)
        const info = m.chunks.find((x) => x.seq === seq)
        const gate = chunkGates.get(key(trip.tripId, seq))
        let st: ChunkViewState
        if (c === undefined) st = "lost"
        else if (c.uploadState === "pending") {
          st = inflight.has(key(trip.tripId, seq)) ? "uploading" : gate !== undefined && gate.nextAt > now ? "waiting" : "pending"
        } else st = c.uploadState
        views.push({
          seq,
          rows: c?.rows ?? info?.rows ?? 0,
          state: st,
          attempts: gate?.attempts ?? 0,
          nextRetryAt: st === "waiting" ? gate?.nextAt : undefined,
          lastError: c?.lastError ?? (st === "waiting" ? gate?.lastError : undefined)
        })
      }
      const count = (s: ChunkViewState) => views.filter((v) => v.state === s).length
      const sent = count("sent") + count("confirmed")
      const confirmed = count("confirmed")
      const conflict = count("conflict")
      const corrupt = count("corrupt")
      const lost = count("lost")
      const open = views.filter((v) => v.state === "pending" || v.state === "waiting" || v.state === "uploading").length
      const tripGate = tripGates.get(trip.tripId)
      const gateWaiting = tripGate !== undefined && tripGate.nextAt > now
      let sync: TripSync
      if (trip.confirmedAt !== undefined) sync = TripSync.Confirmed({ at: trip.confirmedAt })
      else if (m.status === "recording") sync = TripSync.Recording({ sent, total })
      else if (verifying.has(trip.tripId)) sync = TripSync.Verifying()
      else if (open === 0 && (conflict > 0 || corrupt > 0 || lost > 0 || trip.localDeleted)) {
        sync = TripSync.Incomplete({ missing: lost, corrupt, conflict, localCopy: !trip.localDeleted && lost === 0 })
      } else if (views.some((v) => v.state === "waiting") || gateWaiting) {
        const next = [...views.map((v) => v.nextRetryAt), gateWaiting ? tripGate.nextAt : undefined]
          .filter((x): x is number => x !== undefined)
        sync = TripSync.Waiting({
          sent,
          total,
          nextRetryAt: next.length > 0 ? Math.min(...next) : undefined,
          lastError: views.find((v) => v.state === "waiting")?.lastError ?? tripGate?.lastError ?? ""
        })
      } else if (sent > 0 || views.some((v) => v.state === "uploading")) {
        sync = TripSync.Uploading({ sent, total, confirmed })
      } else sync = TripSync.Queued({ total })
      return {
        tripId: trip.tripId,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        points: m.chunks.reduce((n, c) => n + c.rows, 0),
        distanceKm: trip.distanceKm,
        sync,
        chunks: views,
        cloud: undefined
      }
    }

    const cloudInfo = (t: TripSummaryT): TripSyncInfo => ({
      tripId: t.tripId,
      startedAt: t.startedAt,
      endedAt: t.endedAt ?? undefined,
      points: undefined,
      distanceKm: undefined,
      sync: TripSync.CloudOnly(),
      chunks: [],
      cloud: { received: t.received, chunkCount: t.chunkCount, complete: t.complete }
    })

    const mergeTrips = (local: ReadonlyArray<TripSyncInfo>): ReadonlyArray<TripSyncInfo> => {
      const known = new Set(local.map((t) => t.tripId))
      const cloud = cloudTrips.filter((t) => !known.has(t.tripId)).map(cloudInfo)
      return [...local, ...cloud].sort((a, b) => b.startedAt - a.startedAt)
    }

    const publishAll = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      const trips = yield* store.listTrips
      const infos: Array<TripSyncInfo> = []
      for (const t of trips) infos.push(derive(t, yield* store.listChunks(t.tripId), now))
      yield* SubscriptionRef.update(state, (s) => ({ ...s, trips: mergeTrips(infos) }))
    })

    const publishTrip = (tripId: string) =>
      Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const trip = yield* store.getTrip(tripId)
        if (trip === undefined) return
        const info = derive(trip, yield* store.listChunks(tripId), now)
        yield* SubscriptionRef.update(state, (s) => {
          const local = s.trips.filter((t) => t.sync._tag !== "CloudOnly" || t.tripId === tripId).filter((t) => t.tripId !== tripId)
          return { ...s, trips: mergeTrips([...local, info]) }
        })
      }).pipe(Effect.catch(() => Effect.void))

    const setStatus = (status: SyncStatus) => SubscriptionRef.update(state, (s) => ({ ...s, status }))

    // ---- failure handling -------------------------------------------------

    const reauthStatus = Effect.gen(function*() {
      const c = yield* api.credential
      return SyncStatus.NeedsReauth({ reason: c !== undefined ? "device_revoked" : "not_paired" })
    })

    /** Converts failures that stop the whole engine into `Halt`. */
    const guard = <A>(eff: Effect.Effect<A, ApiFailure>): Effect.Effect<A, ApiFailure | Halt> =>
      eff.pipe(
        Effect.catch((f) =>
          Effect.gen(function*() {
            if (f.code === "unauthorized") return yield* Effect.fail(new Halt({ status: yield* reauthStatus }))
            if (f.code === "plugin_disabled" || f.code === "forbidden") {
              return yield* Effect.fail(new Halt({ status: SyncStatus.Blocked({ code: f.code }) }))
            }
            if ((f.code === "network" || f.code === "timeout") && !(yield* lifecycle.isOnline)) {
              return yield* Effect.fail(new Halt({ status: SyncStatus.Offline() }))
            }
            return yield* Effect.fail(f)
          })
        )
      )

    const bump = (gates: Map<string, Gate>, k: string, message: string, now: number, jitter: number, checksum = false) => {
      const g = gates.get(k) ?? { attempts: 0, nextAt: 0, lastError: "", checksumFails: 0 }
      g.attempts += 1
      if (checksum) g.checksumFails += 1
      g.nextAt = now + backoffDelayMs(g.attempts, jitter)
      g.lastError = message
      gates.set(k, g)
      return g
    }

    // ---- uploading --------------------------------------------------------

    const uploadChunk = (c: ChunkRecord) =>
      Effect.gen(function*() {
        const k = key(c.tripId, c.seq)
        inflight.add(k)
        yield* publishTrip(c.tripId)
        const result = yield* guard(api.putChunk(c.tripId, c.seq, c.csv, c.sha256)).pipe(
          Effect.map((r) => (r.sha256 === c.sha256 ? undefined : new ApiFailure({ code: "checksum_mismatch", retryable: true, message: "Server stored different bytes" }))),
          Effect.catchTag("ApiFailure", (f) => Effect.succeed(f)),
          Effect.ensuring(Effect.sync(() => void inflight.delete(k)))
        )
        const now = yield* Clock.currentTimeMillis
        if (result === undefined) {
          chunkGates.delete(k)
          yield* store.setChunkState(c.tripId, c.seq, "sent")
        } else if (result.code === "chunk_conflict") {
          chunkGates.delete(k)
          yield* store.setChunkState(c.tripId, c.seq, "conflict", result.message)
        } else if (result.code === "checksum_mismatch") {
          const g = bump(chunkGates, k, result.message, now, yield* Random.next, true)
          if (g.checksumFails >= CHECKSUM_RETRIES) {
            chunkGates.delete(k)
            yield* store.setChunkState(c.tripId, c.seq, "corrupt", "Checksum kept failing in transit")
          }
        } else if (result.code === "not_found") {
          // Server does not know the trip: re-send the manifest first.
          yield* store.updateTrip(c.tripId, (t) => ({ ...t, manifestSentRev: 0 }))
          bump(chunkGates, k, result.message, now, yield* Random.next)
        } else if (result.retryable) {
          bump(chunkGates, k, result.message, now, yield* Random.next)
        } else {
          chunkGates.delete(k)
          yield* store.setChunkState(c.tripId, c.seq, "corrupt", result.message)
        }
        yield* publishTrip(c.tripId)
      })

    const sendManifestIfDirty = (tripId: string) =>
      Effect.gen(function*() {
        const t = yield* store.getTrip(tripId)
        if (t === undefined || t.manifestRev <= t.manifestSentRev) return true
        const rev = t.manifestRev
        const ok = yield* guard(api.putManifest(t.manifest)).pipe(
          Effect.as(true),
          Effect.catchTag("ApiFailure", (f) =>
            Effect.gen(function*() {
              const now = yield* Clock.currentTimeMillis
              if (f.retryable) bump(tripGates, tripId, f.message, now, yield* Random.next)
              else tripGates.set(tripId, { attempts: 99, nextAt: now + BACKOFF_CAP_MS, lastError: f.message, checksumFails: 0 })
              return false
            })
          )
        )
        if (ok) {
          tripGates.delete(tripId)
          yield* store.updateTrip(tripId, (x) => ({ ...x, manifestSentRev: Math.max(x.manifestSentRev, rev) }))
        }
        return ok
      })

    const reconcile = (tripId: string, status: TripStatus) =>
      Effect.gen(function*() {
        const trip = yield* store.getTrip(tripId)
        if (trip === undefined) return "done" as const
        const chunks = yield* store.listChunks(tripId)
        const bySeq = new Map(chunks.map((c) => [c.seq, c]))
        const total = Math.max(trip.manifest.chunkCount, trip.manifest.chunks.length)
        const bad = chunks.some((c) => c.uploadState === "conflict" || c.uploadState === "corrupt")
        const lost = [...Array(total).keys()].some((s) => !bySeq.has(s))
        if (status.complete && status.missing.length === 0 && status.corrupt.length === 0 && !bad && !lost) {
          const now = yield* Clock.currentTimeMillis
          for (const c of chunks) if (c.uploadState !== "confirmed") yield* store.setChunkState(tripId, c.seq, "confirmed")
          yield* store.updateTrip(tripId, (t) => ({ ...t, confirmedAt: now }))
          tripGates.delete(tripId)
          rounds.delete(tripId)
          return "done" as const
        }
        // Server is missing / has corrupt objects: re-queue from local data.
        const round = (rounds.get(tripId) ?? 0) + 1
        let requeued = 0
        for (const seq of [...status.missing, ...status.corrupt]) {
          const c = bySeq.get(seq)
          if (c === undefined || c.uploadState === "conflict" || c.uploadState === "corrupt") continue
          if (round > RECONCILE_ROUNDS && status.corrupt.includes(seq)) {
            yield* store.setChunkState(tripId, seq, "corrupt", "Server keeps reporting this part as corrupt")
            continue
          }
          chunkGates.delete(key(tripId, seq))
          yield* store.setChunkState(tripId, seq, "pending", "re-sent: server reported it " + (status.missing.includes(seq) ? "missing" : "corrupt"))
          requeued += 1
        }
        rounds.set(tripId, round)
        if (requeued > 0 && round <= RECONCILE_ROUNDS) return "again" as const
        if (!bad && !lost && requeued === 0 && !status.complete) {
          const now = yield* Clock.currentTimeMillis
          bump(tripGates, tripId, "The server has not marked this trip complete yet", now, yield* Random.next)
        }
        if (bad || lost) {
          const now = yield* Clock.currentTimeMillis
          tripGates.set(tripId, { attempts: 0, nextAt: now + BACKOFF_CAP_MS, lastError: "needs user action", checksumFails: 0 })
        }
        return "stuck" as const
      })

    const syncTrip = (tripId: string) =>
      Effect.gen(function*() {
        for (let round = 0; round < RECONCILE_ROUNDS + 2; round++) {
          const now = yield* Clock.currentTimeMillis
          const trip = yield* store.getTrip(tripId)
          if (trip === undefined || trip.confirmedAt !== undefined || trip.localDeleted) return
          const gate = tripGates.get(tripId)
          if (gate !== undefined && gate.nextAt > now) return
          if (!(yield* sendManifestIfDirty(tripId))) {
            yield* publishTrip(tripId)
            return
          }
          const chunks = yield* store.listChunks(tripId)
          const due = chunks.filter((c) => {
            if (c.uploadState !== "pending") return false
            const g = chunkGates.get(key(tripId, c.seq))
            return g === undefined || g.nextAt <= now
          })
          yield* Effect.forEach(due, uploadChunk, { concurrency: CHUNK_CONCURRENCY, discard: true })
          if (trip.manifest.status === "recording") {
            yield* publishTrip(tripId)
            return
          }
          const after = yield* store.listChunks(tripId)
          if (after.some((c) => c.uploadState === "pending")) {
            yield* publishTrip(tripId)
            return
          }
          // All chunks sent (or terminally failed): final manifest, finish, verify.
          if (!(yield* sendManifestIfDirty(tripId))) {
            yield* publishTrip(tripId)
            return
          }
          verifying.add(tripId)
          yield* publishTrip(tripId)
          const fresh = yield* store.getTrip(tripId)
          const call = fresh?.finishSent === true ? api.status(tripId) : api.finish(tripId)
          const statusResult = yield* guard(call).pipe(
            Effect.ensuring(Effect.sync(() => void verifying.delete(tripId))),
            Effect.catchTag("ApiFailure", (f) =>
              Effect.gen(function*() {
                const t = yield* Clock.currentTimeMillis
                bump(tripGates, tripId, f.message, t, yield* Random.next)
                return undefined
              })
            )
          )
          if (statusResult === undefined) {
            yield* publishTrip(tripId)
            return
          }
          if (fresh?.finishSent !== true) yield* store.updateTrip(tripId, (t) => ({ ...t, finishSent: true }))
          const verdict = yield* reconcile(tripId, statusResult)
          yield* publishTrip(tripId)
          if (verdict !== "again") return
        }
      })

    // ---- the pass ---------------------------------------------------------

    const startup = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      if (startupGate !== undefined && startupGate.nextAt > now) return
      const me = yield* guard(api.me).pipe(Effect.catchTag("ApiFailure", () => Effect.succeed(undefined)))
      if (me !== undefined) {
        yield* SubscriptionRef.update(state, (s) => ({ ...s, clockOffsetMs: now - me.serverTime }))
        if (!me.pluginEnabled) return yield* Effect.fail(new Halt({ status: SyncStatus.Blocked({ code: "plugin_disabled" }) }))
      }
      const list = yield* guard(api.listTrips(50)).pipe(Effect.catchTag("ApiFailure", () => Effect.succeed(undefined)))
      if (me === undefined || list === undefined) {
        const g = startupGate ?? { attempts: 0, nextAt: 0, lastError: "", checksumFails: 0 }
        g.attempts += 1
        g.nextAt = now + backoffDelayMs(g.attempts, yield* Random.next)
        startupGate = g
        return
      }
      cloudTrips = list.trips
      startupDone = true
      refreshCloud = false
      startupGate = undefined
    })

    const cleanup = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      for (const t of yield* store.listTrips) {
        if (t.confirmedAt !== undefined && now - t.confirmedAt > LOCAL_RETENTION_MS) yield* store.deleteTrip(t.tripId)
      }
    })

    const pass = Effect.gen(function*() {
      const early = (status: SyncStatus) => setStatus(status).pipe(Effect.andThen(publishAll))
      if (paused) return yield* early(SyncStatus.Paused())
      if (halt !== undefined) return yield* early(halt)
      if ((yield* api.credential) === undefined) return yield* early(yield* reauthStatus)
      if (!(yield* lifecycle.isOnline)) return yield* early(SyncStatus.Offline())
      yield* setStatus(SyncStatus.Syncing())
      yield* cleanup
      if (!startupDone || refreshCloud) yield* startup
      const trips = yield* store.listTrips
      yield* Effect.forEach(trips, (t) => syncTrip(t.tripId), { discard: true })
      const now = yield* Clock.currentTimeMillis
      yield* SubscriptionRef.update(state, (s) => ({ ...s, status: SyncStatus.Idle(), lastSyncAt: now }))
      yield* publishAll
    }).pipe(
      Effect.catchTag("Halt", (h) =>
        Effect.gen(function*() {
          if (h.status._tag !== "Offline") halt = h.status
          yield* setStatus(h.status)
          yield* publishAll
        })
      ),
      Effect.catchTag("StorageFailure", (e) =>
        SubscriptionRef.update(state, (s) => ({ ...s, status: SyncStatus.Idle(), lastError: e.message }))
      )
    )

    const nextWakeAt = (now: number): number | undefined => {
      const times: Array<number> = []
      for (const g of chunkGates.values()) if (g.nextAt > now) times.push(g.nextAt)
      for (const g of tripGates.values()) if (g.nextAt > now) times.push(g.nextAt)
      if (startupGate !== undefined && startupGate.nextAt > now) times.push(startupGate.nextAt)
      return times.length === 0 ? undefined : Math.min(...times)
    }

    const waitForWork = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      const next = halt !== undefined || paused ? undefined : nextWakeAt(now)
      const take = Queue.take(wake)
      if (next === undefined) yield* take
      else yield* take.pipe(Effect.timeoutOption(Duration.millis(next - now)))
    })

    yield* Effect.forkScoped(Effect.forever(pass.pipe(Effect.andThen(waitForWork))))
    yield* Effect.forkScoped(
      lifecycle.online.pipe(
        Stream.runForEach((on) => (on ? kick : setStatus(SyncStatus.Offline())))
      )
    )
    yield* Effect.forkScoped(store.changes.pipe(Stream.runForEach(() => kick)))
    yield* kick

    const retryNow = (tripId?: string) =>
      Effect.gen(function*() {
        halt = undefined
        refreshCloud = true
        startupGate = undefined
        const reset = (tid: string | undefined) =>
          Effect.gen(function*() {
            const trips = tid === undefined ? yield* store.listTrips : [yield* store.getTrip(tid)]
            for (const t of trips) {
              if (t === undefined) continue
              tripGates.delete(t.tripId)
              rounds.delete(t.tripId)
              for (const c of yield* store.listChunks(t.tripId)) {
                const k = key(t.tripId, c.seq)
                chunkGates.delete(k)
                if (c.uploadState === "corrupt") yield* store.setChunkState(t.tripId, c.seq, "pending")
              }
            }
          }).pipe(Effect.catch(() => Effect.void))
        yield* reset(tripId)
        yield* kick
      })

    return SyncEngine.of({
      state,
      retryNow,
      pause: Effect.sync(() => void (paused = true)).pipe(Effect.andThen(setStatus(SyncStatus.Paused()))),
      resume: Effect.sync(() => void (paused = false)).pipe(Effect.andThen(kick)),
      discardLocal: (tripId) =>
        Effect.gen(function*() {
          const t = yield* store.getTrip(tripId)
          if (t === undefined) return
          if (t.confirmedAt !== undefined) yield* store.deleteTrip(tripId)
          else {
            yield* store.deleteChunks(tripId)
            yield* store.updateTrip(tripId, (x) => ({ ...x, localDeleted: true }))
          }
          yield* publishAll
        }),
      refresh: publishAll
    })
  })
)
