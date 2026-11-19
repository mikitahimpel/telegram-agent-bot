import { Clock, Context, Data, Effect, Fiber, Layer, Random, Semaphore, Stream, SubscriptionRef } from "effect"
import { makeTripId, type Gap, type TripManifest } from "@bot/car-format/manifest"
import { distanceStep } from "@bot/car-format/metrics"
import type { Sample } from "@bot/car-format/sample"
import { RecorderFailure, StorageFailure, type StorageFailureReason } from "./errors.ts"
import { AppLifecycle, GeoSource, WakeLock, type GeoFix } from "./platform.ts"
import { TripStore } from "./store.ts"

export type ReadingEvent =
  | { readonly _tag: "Reading"; readonly sample: Sample }
  | { readonly _tag: "GapStarted"; readonly at: number; readonly reason: string }
  | { readonly _tag: "GapEnded"; readonly at: number }

export interface ReadingSource {
  readonly readings: () => Stream.Stream<ReadingEvent, unknown>
}

export interface ReadingInfo {
  readonly adapterName?: string | undefined
  readonly elmVersion?: string | undefined
  readonly obdProtocol?: string | undefined
  readonly vin?: string | undefined
  readonly supportedPids: ReadonlyArray<string>
  readonly fuelRateSource: "pid_5e" | "maf_estimate" | "none"
  readonly transport: "ble" | "serial" | "simulator"
}

export type GeoStatus = "off" | "acquiring" | "ok" | "denied" | "unavailable"

export type RecorderState = Data.TaggedEnum<{
  Idle: {}
  Recording: {
    readonly tripId: string
    readonly startedAt: number
    readonly points: number
    readonly chunks: number
    readonly distanceKm: number
    readonly lastSampleAt: number | undefined
    readonly gapOpen: boolean
    readonly sourceEnded: boolean
    readonly storageError: StorageFailureReason | undefined
    readonly geo: GeoStatus
    readonly wakeLock: boolean
  }
  Finishing: { readonly tripId: string }
  Error: { readonly reason: string; readonly tripId: string | undefined }
}>
export const RecorderState = Data.taggedEnum<RecorderState>()

export interface StartOptions {
  readonly source: ReadingSource
  readonly info: ReadingInfo
  readonly geo?: boolean
  readonly appVersion?: string
  readonly note?: string
  readonly clockOffsetMs?: number
}

export interface InterruptedTrip {
  readonly tripId: string
  readonly startedAt: number
  readonly lastSampleAt: number
  readonly points: number
  readonly chunks: number
}

export interface RecorderShape {
  readonly state: SubscriptionRef.SubscriptionRef<RecorderState>
  readonly start: (options: StartOptions) => Effect.Effect<string, RecorderFailure | StorageFailure>
  readonly stop: Effect.Effect<void, RecorderFailure | StorageFailure>
  readonly recoverUnfinished: Effect.Effect<ReadonlyArray<InterruptedTrip>, StorageFailure>
  readonly resume: (
    tripId: string,
    source: ReadingSource,
    options?: { readonly geo?: boolean }
  ) => Effect.Effect<void, RecorderFailure | StorageFailure>
  readonly finishInterrupted: (tripId: string) => Effect.Effect<void, RecorderFailure | StorageFailure>
}

export class Recorder extends Context.Service<Recorder, RecorderShape>()("@bot/car-recorder/Recorder") {}

export const FLUSH_EVERY_MS = 5_000
export const SEAL_EVERY_MS = 30_000
export const SEAL_ROWS = 300
export const GPS_MAX_AGE_MS = 5_000
export const CLOCK_WARN_MS = 2 * 60_000

const KNOWN_REASONS: ReadonlyArray<Gap["reason"]> = [
  "adapter_disconnected",
  "ecu_no_response",
  "app_backgrounded",
  "app_restarted",
  "unknown"
]
const toReason = (r: string): Gap["reason"] => (KNOWN_REASONS as ReadonlyArray<string>).includes(r) ? (r as Gap["reason"]) : "unknown"

interface Session {
  readonly tripId: string
  readonly startedAt: number
  buffer: Array<Sample>
  pendingRows: number
  chunkStartedAt: number
  sourceGap: { readonly from: number; readonly reason: Gap["reason"] } | undefined
  bgGap: { readonly from: number } | undefined
  fix: GeoFix | undefined
  geo: GeoStatus
  wakeLock: boolean
  storageError: StorageFailureReason | undefined
  sourceEnded: boolean
  points: number
  chunks: number
  distanceKm: number
  prev: Sample | undefined
  lastSampleAt: number | undefined
  fibers: Array<Fiber.Fiber<unknown, unknown>>
}

export const layer: Layer.Layer<Recorder, never, TripStore | GeoSource | WakeLock | AppLifecycle> = Layer.effect(
  Recorder,
  Effect.gen(function*() {
    const store = yield* TripStore
    const geoSource = yield* GeoSource
    const wakeLock = yield* WakeLock
    const lifecycle = yield* AppLifecycle
    const layerScope = yield* Effect.scope
    const state = yield* SubscriptionRef.make<RecorderState>(RecorderState.Idle())
    const lock = yield* Semaphore.make(1)
    let session: Session | undefined

    const publish = (s: Session) =>
      SubscriptionRef.set(
        state,
        RecorderState.Recording({
          tripId: s.tripId,
          startedAt: s.startedAt,
          points: s.points,
          chunks: s.chunks,
          distanceKm: s.distanceKm,
          lastSampleAt: s.lastSampleAt,
          gapOpen: s.sourceGap !== undefined || s.bgGap !== undefined,
          sourceEnded: s.sourceEnded,
          storageError: s.storageError,
          geo: s.geo,
          wakeLock: s.wakeLock
        })
      )

    const addGap = (s: Session, gap: Gap) =>
      store.updateManifest(s.tripId, (m) => ({ ...m, gaps: [...m.gaps, gap] })).pipe(
        Effect.catch(() => Effect.void)
      )

    const closeSourceGap = (s: Session, to: number) =>
      Effect.gen(function*() {
        const g = s.sourceGap
        if (g === undefined) return
        s.prev = undefined
        s.sourceGap = undefined
        yield* addGap(s, { from: g.from, to: Math.max(to, g.from), reason: g.reason })
        yield* publish(s)
      })
    const closeBgGap = (s: Session, to: number) =>
      Effect.gen(function*() {
        const g = s.bgGap
        if (g === undefined) return
        s.prev = undefined
        s.bgGap = undefined
        yield* addGap(s, { from: g.from, to: Math.max(to, g.from), reason: "app_backgrounded" })
        yield* publish(s)
      })

    const tick = (s: Session, force: boolean) =>
      lock.withPermits(1)(
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const batch = s.buffer
          s.buffer = []
          const flushed = yield* store.appendPending(s.tripId, batch).pipe(
            Effect.as(undefined),
            Effect.catch((e) => Effect.succeed(e))
          )
          if (flushed !== undefined) {
            s.buffer = [...batch, ...s.buffer]
            s.storageError = flushed.reason
            yield* publish(s)
            return
          }
          if (batch.length > 0) {
            const km = s.distanceKm
            yield* store.updateTrip(s.tripId, (t) => ({ ...t, distanceKm: km })).pipe(Effect.catch(() => Effect.void))
          }
          s.pendingRows += batch.length
          s.storageError = undefined
          if (s.pendingRows > 0 && (force || s.pendingRows >= SEAL_ROWS || now - s.chunkStartedAt >= SEAL_EVERY_MS)) {
            const sealed = yield* store.sealPending(s.tripId).pipe(Effect.catch((e) => Effect.succeed(e)))
            if (sealed instanceof StorageFailure) {
              s.storageError = sealed.reason
            } else if (sealed !== undefined) {
              s.pendingRows = 0
              s.chunks += 1
              s.chunkStartedAt = now
            }
          } else if (s.pendingRows === 0) {
            s.chunkStartedAt = now
          }
          yield* publish(s)
        })
      )

    const onReading = (s: Session, event: ReadingEvent) =>
      Effect.gen(function*() {
        if (event._tag === "Reading") {
          let sample = event.sample
          const fix = s.fix
          if (fix !== undefined && sample.lat === undefined && sample.ts - fix.ts <= GPS_MAX_AGE_MS) {
            sample = {
              ...sample,
              lat: fix.lat,
              lon: fix.lon,
              gpsAccuracyM: sample.gpsAccuracyM ?? fix.accuracyM,
              gpsSpeedKmh: sample.gpsSpeedKmh ?? fix.speedKmh
            }
          }
          if (s.prev !== undefined) {
            const d = distanceStep(s.prev, sample)
            if (d !== undefined) s.distanceKm += d.obdKm ?? d.gpsKm ?? 0
          }
          s.prev = sample
          s.buffer.push(sample)
          s.points += 1
          s.lastSampleAt = sample.ts
          if (s.buffer.length + s.pendingRows >= SEAL_ROWS) yield* tick(s, false)
          else yield* publish(s)
        } else if (event._tag === "GapStarted") {
          if (s.sourceGap === undefined) s.sourceGap = { from: event.at, reason: toReason(event.reason) }
          s.prev = undefined
          yield* publish(s)
        } else {
          yield* closeSourceGap(s, event.at)
        }
      })

    const launch = (s: Session, source: ReadingSource, geo: boolean) =>
      Effect.gen(function*() {
        session = s
        s.wakeLock = yield* wakeLock.acquire
        s.geo = geo ? "acquiring" : "off"
        yield* publish(s)
        const fork = <A, E>(e: Effect.Effect<A, E>) =>
          Effect.forkIn(e, layerScope).pipe(Effect.map((f) => void s.fibers.push(f as Fiber.Fiber<unknown, unknown>)))

        yield* fork(
          source.readings().pipe(
            Stream.runForEach((e) => onReading(s, e)),
            Effect.catch(() => Effect.void),
            Effect.andThen(
              Effect.gen(function*() {
                const now = yield* Clock.currentTimeMillis
                s.sourceEnded = true
                if (s.sourceGap === undefined) s.sourceGap = { from: now, reason: "adapter_disconnected" }
                yield* publish(s)
              })
            )
          )
        )
        yield* fork(
          Effect.forever(Effect.sleep(FLUSH_EVERY_MS).pipe(Effect.andThen(tick(s, false))))
        )
        if (geo) {
          yield* fork(
            geoSource.watch.pipe(
              Stream.runForEach((fix) => {
                s.fix = fix
                s.geo = "ok"
                return publish(s)
              }),
              Effect.catch((e) => {
                s.geo = e.reason === "denied" ? "denied" : "unavailable"
                return publish(s)
              })
            )
          )
        }
        yield* fork(
          lifecycle.visibility.pipe(
            Stream.runForEach((v) =>
              Effect.gen(function*() {
                const now = yield* Clock.currentTimeMillis
                if (v === "hidden") {
                  if (s.bgGap === undefined) s.bgGap = { from: now }
                  s.prev = undefined
                  yield* publish(s)
                } else {
                  yield* closeBgGap(s, now)
                  s.wakeLock = yield* wakeLock.acquire
                  yield* publish(s)
                }
              })
            )
          )
        )
      })

    const teardown = (s: Session) =>
      Effect.gen(function*() {
        yield* Effect.forEach(s.fibers, (f) => Fiber.interrupt(f), { discard: true })
        s.fibers = []
        const now = yield* Clock.currentTimeMillis
        yield* closeBgGap(s, now)
        yield* closeSourceGap(s, now)
      })

    const finalize = (tripId: string, endedAt: number | undefined) =>
      Effect.gen(function*() {
        yield* store.sealPending(tripId)
        const trip = yield* store.updateManifest(tripId, (m) => ({
          ...m,
          status: "finished" as const,
          endedAt: endedAt ?? m.endedAt ?? m.startedAt,
          chunkCount: m.chunks.length
        }))
        if (trip === undefined) {
          return yield* Effect.fail(new RecorderFailure({ reason: "not_found", message: `Trip ${tripId} not found` }))
        }
      })

    const stop = Effect.gen(function*() {
      const s = session
      if (s === undefined) return
      yield* SubscriptionRef.set(state, RecorderState.Finishing({ tripId: s.tripId }))
      yield* teardown(s)
      const failure = yield* tick(s, true).pipe(
        Effect.andThen(
          s.storageError !== undefined
            ? Effect.fail(new StorageFailure({ reason: s.storageError, message: "Could not save the last samples" }))
            : finalize(s.tripId, s.lastSampleAt)
        ),
        Effect.as(undefined),
        Effect.catch((e) => Effect.succeed(e))
      )
      yield* wakeLock.release
      session = undefined
      if (failure !== undefined) {
        yield* SubscriptionRef.set(state, RecorderState.Error({ reason: failure.message, tripId: s.tripId }))
        return yield* Effect.fail(failure)
      }
      yield* SubscriptionRef.set(state, RecorderState.Idle())
    })

    const newSession = (tripId: string, startedAt: number, now: number, points: number, chunks: number, lastSampleAt: number | undefined, distanceKm = 0): Session => ({
      tripId,
      startedAt,
      buffer: [],
      pendingRows: 0,
      chunkStartedAt: now,
      sourceGap: undefined,
      bgGap: undefined,
      fix: undefined,
      geo: "off",
      wakeLock: false,
      storageError: undefined,
      sourceEnded: false,
      points,
      chunks,
      distanceKm,
      prev: undefined,
      lastSampleAt,
      fibers: []
    })

    const busy = Effect.fail(new RecorderFailure({ reason: "busy", message: "A trip is already being recorded" }))

    const start = (o: StartOptions) =>
      Effect.gen(function*() {
        if (session !== undefined) return yield* busy
        const now = yield* Clock.currentTimeMillis
        const rnd = yield* Random.nextInt
        const tripId = makeTripId(new Date(now), Math.abs(rnd).toString(36))
        const offset = o.clockOffsetMs
        const clockNote = offset !== undefined && Math.abs(offset) > CLOCK_WARN_MS ? `clock_offset_ms=${Math.round(offset)}` : undefined
        const note = [o.note, clockNote].filter((x): x is string => x !== undefined).join("; ")
        const manifest: TripManifest = {
          formatVersion: 1,
          tripId,
          status: "recording",
          startedAt: now,
          chunkCount: 0,
          chunks: [],
          gaps: [],
          supportedPids: [...o.info.supportedPids],
          device: {
            appVersion: o.appVersion ?? "dev",
            userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
            transport: o.info.transport,
            ...(o.info.adapterName !== undefined ? { adapterName: o.info.adapterName } : {}),
            ...(o.info.obdProtocol !== undefined ? { obdProtocol: o.info.obdProtocol } : {}),
            ...(o.info.vin !== undefined ? { vin: o.info.vin } : {})
          },
          fuelRateSource: o.info.fuelRateSource,
          ...(note !== "" ? { note } : {})
        }
        yield* store.createTrip(manifest)
        yield* launch(newSession(tripId, now, now, 0, 0, undefined), o.source, o.geo ?? false)
        return tripId as string
      })

    const interrupted = (t: { readonly tripId: string }) => store.getTrip(t.tripId)

    const recoverUnfinished = Effect.gen(function*() {
      const trips = yield* store.listTrips
      const out: Array<InterruptedTrip> = []
      for (const t of trips) {
        if (t.manifest.status !== "recording" || t.tripId === session?.tripId) continue
        const pending = yield* store.readPending(t.tripId)
        out.push({
          tripId: t.tripId,
          startedAt: t.manifest.startedAt,
          lastSampleAt: pending[pending.length - 1]?.ts ?? t.lastSampleAt ?? t.manifest.startedAt,
          points: t.manifest.chunks.reduce((n, c) => n + c.rows, 0) + pending.length,
          chunks: t.manifest.chunks.length
        })
      }
      return out as ReadonlyArray<InterruptedTrip>
    })

    const loadInterrupted = (tripId: string) =>
      Effect.gen(function*() {
        const t = yield* interrupted({ tripId })
        if (t === undefined) return yield* Effect.fail(new RecorderFailure({ reason: "not_found", message: `Trip ${tripId} not found` }))
        if (t.manifest.status !== "recording") {
          return yield* Effect.fail(new RecorderFailure({ reason: "not_interrupted", message: `Trip ${tripId} is already finished` }))
        }
        return t
      })

    const resume = (tripId: string, source: ReadingSource, options?: { readonly geo?: boolean }) =>
      Effect.gen(function*() {
        if (session !== undefined) return yield* busy
        const t = yield* loadInterrupted(tripId)
        const now = yield* Clock.currentTimeMillis
        const pending = yield* store.readPending(tripId)
        const lastSampleAt = pending[pending.length - 1]?.ts ?? t.lastSampleAt ?? t.manifest.startedAt
        const points = t.manifest.chunks.reduce((n, c) => n + c.rows, 0) + pending.length
        yield* store.sealPending(tripId)
        yield* store.updateManifest(tripId, (m) => ({ ...m, gaps: [...m.gaps, { from: lastSampleAt, to: now, reason: "app_restarted" as const }] }))
        const fresh = yield* store.getTrip(tripId)
        yield* launch(newSession(tripId, t.manifest.startedAt, now, points, fresh?.manifest.chunks.length ?? 0, lastSampleAt, t.distanceKm ?? 0), source, options?.geo ?? false)
      })

    const finishInterrupted = (tripId: string) =>
      Effect.gen(function*() {
        if (session?.tripId === tripId) return yield* busy
        const t = yield* loadInterrupted(tripId)
        const pending = yield* store.readPending(tripId)
        yield* finalize(tripId, pending[pending.length - 1]?.ts ?? t.lastSampleAt ?? t.manifest.startedAt)
      })

    return Recorder.of({ state, start, stop, recoverUnfinished, resume, finishInterrupted })
  })
)
