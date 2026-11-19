import { Effect, Exit, Fiber, Scope, Stream, SubscriptionRef } from "effect"
import { connect as obdConnect, type ObdEvent, type ObdSample, type ObdSession } from "@bot/car-obd/session"
import type { ConnectionState } from "@bot/car-obd/state"
import type { ObdError } from "@bot/car-obd/errors"
import { CarApi } from "@bot/car-recorder/api-client"
import { exportTrip, shareFiles } from "@bot/car-recorder/export"
import { Recorder, type ReadingSource } from "@bot/car-recorder/recorder"
import type { makeCarRuntime } from "@bot/car-recorder/runtime"
import { TripStore } from "@bot/car-recorder/store"
import { SyncEngine } from "@bot/car-recorder/sync"
import type { Gap } from "@bot/car-format/manifest"
import type { DiagEvent, Reading, SimScenario, TransportKind } from "../model/types.ts"
import type { CarBackend } from "./backend.ts"
import { mapConnectionState, mapObdError, sensorsFromInfo } from "./map-obd.ts"
import { mapRecorderState, mapSyncStatus, mapSyncTrips } from "./map-recorder.ts"

type CarRuntime = ReturnType<typeof makeCarRuntime>

/**
 * Wires @bot/car-obd (adapter) and @bot/car-recorder (store, recorder, sync, API) on top of a base backend
 * that only supplies the Vue refs.
 */
export const withRealBackend = (base: CarBackend, runtime: CarRuntime, appVersion: string): CarBackend => {
  let scope: Scope.Closeable | null = null
  let session: ObdSession | null = null
  let preview: Fiber.Fiber<unknown, unknown> | null = null
  let fibers: Fiber.Fiber<unknown, unknown>[] = []
  let generation = 0
  let resumeTripId: string | null = null
  const gaps = new Map<string, ReadonlyArray<Gap>>()
  let lastSync: Parameters<typeof mapSyncTrips>[0] | null = null

  const log = (kind: DiagEvent["kind"], text: string) => {
    base.diag.value = [...base.diag.value, { at: Date.now(), kind, text }].slice(-500)
  }
  const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runFork(eff)

  const applySample = (s: ObdSample) => {
    const prev: Reading = base.reading.value
    const pick = (v: number | undefined, p: number | null) => (v === undefined ? p : v)
    base.reading.value = {
      speedKmh: pick(s.speedKmh, prev.speedKmh),
      rpm: pick(s.rpm, prev.rpm),
      coolantC: pick(s.coolantC, prev.coolantC),
      fuelRateLph: pick(s.fuelRateLph, prev.fuelRateLph),
      voltageV: pick(s.voltageV, prev.voltageV)
    }
  }
  const onEvent = (e: ObdEvent) => {
    if (e._tag === "Reading") applySample(e.sample)
    else log("obd", e._tag === "GapStarted" ? `gap started: ${e.reason}` : "gap ended")
  }

  const fail = (e: ObdError) => {
    log("error", `${e._tag}: ${JSON.stringify(e)}`)
    base.conn.value = { _tag: "Failed", error: mapObdError(e) }
  }

  const stopPreview = () => {
    if (preview) run(Fiber.interrupt(preview))
    preview = null
  }
  const startPreview = () => {
    stopPreview()
    if (!session) return
    preview = run(
      Stream.runForEach(session.readings({ intervalMs: base.pollingMs.value }), (e) => Effect.sync(() => onEvent(e))).pipe(
        Effect.catch((e: ObdError) => Effect.sync(() => fail(e)))
      )
    )
  }

  const source = (): ReadingSource => ({
    readings: () =>
      session!.readings({ intervalMs: base.pollingMs.value }).pipe(
        Stream.tap((e) => Effect.sync(() => onEvent(e)))
      )
  })

  const closeSession = async () => {
    generation++
    stopPreview()
    for (const f of fibers) run(Fiber.interrupt(f))
    fibers = []
    session = null
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void))
    scope = null
  }

  const recompute = () => {
    if (lastSync) base.trips.value = mapSyncTrips(lastSync, gaps, Date.now())
  }
  const refreshGaps = async () => {
    try {
      const all = await runtime.runPromise(TripStore.use((s) => s.listTrips))
      for (const t of all) gaps.set(t.tripId, t.manifest.gaps)
      recompute()
    } catch (e) {
      log("error", `store: ${String(e)}`)
    }
  }
  const refreshStorage = async () => {
    try {
      const h = await runtime.runPromise(TripStore.use((s) => s.storageHealth))
      base.storage.value = h.supported ? { usedBytes: h.usage, quotaBytes: h.quota, persisted: h.persisted } : null
    } catch {
      base.storage.value = null
    }
  }
  const refreshDevices = async () => {
    try {
      const list = await runtime.runPromise(CarApi.use((a) => a.devices))
      base.devices.value = list.devices.map((d) => ({ id: d.deviceId, name: d.name, lastSeenAt: d.lastSeenAt, current: false }))
    } catch {
      /* offline or not paired: keep the previous list */
    }
  }

  // Long-lived subscriptions.
  runtime.runFork(
    Effect.gen(function*() {
      const sync = yield* SyncEngine
      yield* Stream.runForEach(SubscriptionRef.changes(sync.state), (s) =>
        Effect.sync(() => {
          lastSync = s
          base.sync.value = mapSyncStatus(s.status)
          if (s.clockOffsetMs !== undefined) base.clockOffsetMs.value = s.clockOffsetMs
          recompute()
          if (s.lastError) log("sync", s.lastError)
          void refreshGaps()
        })
      )
    })
  )
  runtime.runFork(
    Effect.gen(function*() {
      const rec = yield* Recorder
      yield* Stream.runForEach(SubscriptionRef.changes(rec.state), (s) =>
        Effect.sync(() => {
          base.rec.value = mapRecorderState(s)
          if (s._tag === "Recording") base.wakeLock.value = s.wakeLock
          else base.wakeLock.value = false
        })
      )
    })
  )
  void runtime
    .runPromise(Recorder.use((r) => r.recoverUnfinished))
    .then((list) => {
      const t = list[0]
      if (t) base.interrupted.value = { tripId: t.tripId, interruptedAt: t.lastSampleAt, points: t.points }
    })
    .catch((e) => log("error", `recover: ${String(e)}`))
  void refreshStorage()
  setInterval(() => void refreshStorage(), 30_000)

  const resumeNow = async () => {
    if (!session || !resumeTripId) return
    const id = resumeTripId
    resumeTripId = null
    stopPreview()
    try {
      await runtime.runPromise(Recorder.use((r) => r.resume(id, source())))
    } catch (e) {
      log("error", `resume: ${String(e)}`)
      base.rec.value = { _tag: "Error", message: String(e) }
    }
  }

  return {
    ...base,
    async connect(kind: TransportKind, scenario?: SimScenario) {
      await closeSession()
      const gen = generation
      const sc = Scope.makeUnsafe()
      scope = sc
      log("obd", `connect ${kind}${scenario ? ` (${scenario})` : ""}`)
      base.conn.value = { _tag: "RequestingDevice" }
      const onState = (s: ConnectionState) => {
        if (gen === generation && s._tag !== "Idle") base.conn.value = mapConnectionState(s)
      }
      const result = await Effect.runPromise(
        obdConnect(kind, { ...(scenario ? { scenario } : {}), onState }).pipe(
          Effect.provideService(Scope.Scope, sc),
          Effect.map((s) => ({ ok: true as const, session: s })),
          Effect.catch((error: ObdError) => Effect.succeed({ ok: false as const, error }))
        )
      )
      if (gen !== generation) return
      if (!result.ok) {
        await Effect.runPromise(Scope.close(sc, Exit.void))
        scope = null
        return fail(result.error)
      }
      session = result.session
      const info = result.session.info
      base.fuelSource.value = info.fuelRateSource
      base.supported.value = sensorsFromInfo(info)
      log("obd", `ready: ${info.adapterName} ${info.obdProtocol} PIDs ${info.supportedPids.join(" ")}`)
      fibers.push(
        run(
          Stream.runForEach(SubscriptionRef.changes(result.session.state), (s: ConnectionState) =>
            Effect.sync(() => {
              if (gen === generation) base.conn.value = mapConnectionState(s)
            })
          )
        )
      )
      if (resumeTripId) await resumeNow()
      else if (base.rec.value._tag !== "Recording") startPreview()
    },
    cancelConnect() {
      void closeSession()
      base.conn.value = { _tag: "Idle" }
    },
    async startRecording() {
      if (!session) return
      stopPreview()
      const info = session.info
      try {
        await runtime.runPromise(
          Recorder.use((r) =>
            r.start({ source: source(), info, appVersion, ...(base.clockOffsetMs.value ? { clockOffsetMs: base.clockOffsetMs.value } : {}) })
          )
        )
      } catch (e) {
        log("error", `start: ${String(e)}`)
        base.rec.value = { _tag: "Error", message: String(e) }
      }
    },
    async stopRecording() {
      try {
        await runtime.runPromise(Recorder.use((r) => r.stop))
      } catch (e) {
        log("error", `stop: ${String(e)}`)
      }
      if (session) startPreview()
      void refreshStorage()
    },
    async resumeInterrupted() {
      const i = base.interrupted.value
      base.interrupted.value = null
      if (!i) return
      resumeTripId = i.tripId
      await resumeNow()
    },
    async finishInterrupted() {
      const i = base.interrupted.value
      base.interrupted.value = null
      if (!i) return
      try {
        await runtime.runPromise(Recorder.use((r) => r.finishInterrupted(i.tripId)))
      } catch (e) {
        log("error", `finish: ${String(e)}`)
      }
    },
    async retryNow(tripId) {
      log("sync", `retry ${tripId}`)
      await runtime.runPromise(SyncEngine.use((s) => s.retryNow(tripId)))
    },
    async exportTrip(tripId) {
      try {
        const files = await runtime.runPromise(exportTrip(tripId))
        const r = await runtime.runPromise(
          shareFiles([{ name: files.fileName, blob: files.csv }, { name: files.manifestFileName, blob: files.manifestJson }], files.fileName)
        )
        log("app", `export ${tripId}: ${r}`)
      } catch (e) {
        log("error", `export: ${String(e)}`)
      }
    },
    async deleteLocal(tripId) {
      await runtime.runPromise(SyncEngine.use((s) => s.discardLocal(tripId)))
    },
    async requestPersistence() {
      const ok = await runtime.runPromise(TripStore.use((s) => s.requestPersistence))
      await refreshStorage()
      return ok
    },
    async adoptCredential(c) {
      await runtime.runPromise(CarApi.use((a) => a.setCredential({ token: c.deviceToken })))
      await runtime.runPromise(SyncEngine.use((s) => s.retryNow()))
      void refreshDevices()
    },
    refreshDevices,
    async revokeDevice(id) {
      await runtime.runPromise(CarApi.use((a) => a.revokeDevice(id)))
      await refreshDevices()
    },
    dispose() {
      void closeSession()
      base.dispose()
      void runtime.dispose()
    }
  }
}
