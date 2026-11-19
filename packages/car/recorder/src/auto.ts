import { Clock, Context, Data, Deferred, Effect, Fiber, Layer, Queue, Stream, SubscriptionRef } from "effect"
import type { DtcReport } from "@bot/car-format/insights"
import type { BatteryEvents, TripEndReason, TripTrigger } from "@bot/car-format/manifest"
import { makeBatteryTracker, type BatteryTracker } from "@bot/car-obd/battery"
import { type DtcScan, scanToReport } from "@bot/car-obd/dtc"
import { Disconnected, type ObdError } from "@bot/car-obd/errors"
import type { ConnectOptions, ObdSession, SessionInfo, WatchTick } from "@bot/car-obd/session"
import { AdapterMemory, type RememberedAdapter } from "./adapter-memory.ts"
import { type ConnectTarget, ObdConnector, type PickedAdapter } from "./connector.ts"
import {
  type EngineDetector,
  type EngineDetectorConfig,
  makeEngineDetector,
  START_RPM,
  STOP_AFTER_MS
} from "./engine-detector.ts"
import type { RecorderFailure, StorageFailure } from "./errors.ts"
import { AppLifecycle, WakeLock } from "./platform.ts"
import { Recorder, type ReadingInfo, type ReadingSource } from "./recorder.ts"
import { TripStore } from "./store.ts"
import { SyncEngine } from "./sync.ts"

export type NeedsTapReason = "first_use" | "unsupported" | "forgotten" | "gesture_required" | "permission_denied"
export type ScanTrigger = "trip_start" | "trip_end" | "manual"

export type AutoState = Data.TaggedEnum<{
  Off: {}
  NeedsTap: { readonly reason: NeedsTapReason }
  Reconnecting: { readonly attempt: number; readonly since: number }
  AdapterNotFound: { readonly since: number; readonly attempts: number; readonly nextRetryAt: number }
  Connecting: { readonly deviceName: string | undefined; readonly step: number; readonly total: number }
  Unavailable: { readonly error: ObdError }
  EcuNotResponding: { readonly since: number; readonly adapterName: string }
  WaitingForEngine: {
    readonly adapterName: string
    readonly rpm: number | undefined
    readonly voltageV: number | undefined
    readonly startingSince: number | undefined
  }
  Recording: {
    readonly tripId: string
    readonly startedAt: number
    readonly trigger: TripTrigger
    readonly adapterName: string
    readonly linkLost: { readonly since: number; readonly attempt: number } | undefined
  }
  AutoStopped: {
    readonly tripId: string
    readonly startedAt: number
    readonly endedAt: number
    readonly reason: TripEndReason
  }
}>
export const AutoState = Data.taggedEnum<AutoState>()

export type CodesFailureReason = "ecu_not_responding" | "disconnected" | "storage" | "not_connected"

export type CodesState = Data.TaggedEnum<{
  NotScanned: {}
  Scanning: { readonly trigger: ScanTrigger }
  Result: {
    readonly trigger: ScanTrigger
    readonly at: number
    readonly report: DtcReport
    readonly modes: DtcScan["modes"]
    readonly reportedCount: number | undefined
    readonly queuedId: string
  }
  Failed: { readonly trigger: ScanTrigger; readonly at: number; readonly reason: CodesFailureReason }
}>
export const CodesState = Data.taggedEnum<CodesState>()

export class AutoNotConnected extends Data.TaggedError("AutoNotConnected")<{
  readonly reason: "no_session" | "not_recording" | "ecu_not_responding" | "disabled"
}> {}

export type AutoFailure = AutoNotConnected | RecorderFailure | StorageFailure | ObdError

export type AutoOptions = {
  readonly geo?: boolean
  readonly appVersion?: string
  readonly detector?: EngineDetectorConfig
  readonly watchIntervalMs?: number
  readonly readingsIntervalMs?: number
  readonly retryBaseMs?: number
  readonly retryMaxMs?: number
  readonly reconnect?: ConnectOptions["reconnect"]
}

export type AutoRecorderShape = {
  readonly state: SubscriptionRef.SubscriptionRef<AutoState>
  readonly codes: SubscriptionRef.SubscriptionRef<CodesState>
  readonly battery: SubscriptionRef.SubscriptionRef<BatteryEvents>
  readonly enable: (options?: AutoOptions) => Effect.Effect<void>
  readonly disable: Effect.Effect<void>
  readonly connectNew: Effect.Effect<void, ObdError>
  readonly startNow: Effect.Effect<string, AutoFailure>
  readonly stopNow: Effect.Effect<void, AutoFailure>
  readonly scanNow: Effect.Effect<DtcReport, AutoFailure>
  readonly dismissStopped: Effect.Effect<void>
  readonly forgetAdapter: Effect.Effect<void>
}

export class AutoRecorder extends Context.Service<AutoRecorder, AutoRecorderShape>()(
  "@bot/car-recorder/AutoRecorder"
) {}

type Command =
  | { readonly _tag: "Start"; readonly reply: Deferred.Deferred<string, AutoFailure> }
  | { readonly _tag: "Stop"; readonly reply: Deferred.Deferred<void, AutoFailure> }

type Decision = { readonly trigger: TripTrigger; readonly reply: Deferred.Deferred<string, AutoFailure> | undefined }

const toReadingInfo = (i: SessionInfo): ReadingInfo => ({
  adapterName: i.adapterName,
  elmVersion: i.elmVersion,
  obdProtocol: i.obdProtocol,
  ...(i.vin !== undefined ? { vin: i.vin } : {}),
  supportedPids: i.supportedPids,
  fuelRateSource: i.fuelRateSource,
  transport: i.transport
})

const nonEmpty = (b: BatteryEvents): boolean => Object.keys(b).length > 0

export const layer: Layer.Layer<
  AutoRecorder,
  never,
  Recorder | SyncEngine | TripStore | WakeLock | ObdConnector | AdapterMemory | AppLifecycle
> = Layer.effect(
  AutoRecorder,
  Effect.gen(function* () {
    const recorder = yield* Recorder
    const sync = yield* SyncEngine
    const store = yield* TripStore
    const wake = yield* WakeLock
    const connector = yield* ObdConnector
    const memory = yield* AdapterMemory
    const lifecycle = yield* AppLifecycle
    const layerScope = yield* Effect.scope

    const state = yield* SubscriptionRef.make<AutoState>(AutoState.Off())
    const codes = yield* SubscriptionRef.make<CodesState>(CodesState.NotScanned())
    const battery = yield* SubscriptionRef.make<BatteryEvents>({})
    const taps = yield* Queue.unbounded<PickedAdapter>()
    const commands = yield* Queue.unbounded<Command>()

    let opts: AutoOptions = {}
    let fiber: Fiber.Fiber<unknown, unknown> | undefined
    let current: ObdSession | undefined
    let established = false
    let activeTripId: string | null = null

    const setState = (s: AutoState) => SubscriptionRef.set(state, s)
    const now = Clock.currentTimeMillis

    const runScan = (session: ObdSession, trigger: ScanTrigger, tripId: string | null) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(codes, CodesState.Scanning({ trigger }))
        const result = yield* Effect.result(session.scanDtc)
        const at = yield* now
        if (result._tag === "Failure") {
          const reason: CodesFailureReason =
            result.failure._tag === "Disconnected" ? "disconnected" : "ecu_not_responding"
          yield* SubscriptionRef.set(codes, CodesState.Failed({ trigger, at, reason }))
          return yield* result.failure
        }
        const scan = result.success
        const report: DtcReport = scanToReport(scan, { readAt: at, tripId, vin: session.info.vin ?? null })
        const queued = yield* Effect.result(sync.queueDtc(report))
        if (queued._tag === "Failure") {
          yield* SubscriptionRef.set(codes, CodesState.Failed({ trigger, at, reason: "storage" }))
          return yield* queued.failure
        }
        yield* SubscriptionRef.set(
          codes,
          CodesState.Result({
            trigger,
            at,
            report,
            modes: scan.modes,
            reportedCount: scan.reportedCount,
            queuedId: queued.success
          })
        )
        return report
      })

    const writeBattery = (tripId: string, tracker: BatteryTracker) =>
      Effect.gen(function* () {
        const report = tracker.report()
        yield* SubscriptionRef.set(battery, report)
        if (nonEmpty(report))
          yield* store.updateManifest(tripId, (m) => ({ ...m, battery: report })).pipe(Effect.ignore)
      })

    const recording = (session: ObdSession, tracker: BatteryTracker, detector: EngineDetector, decision: Decision) =>
      Effect.gen(function* () {
        const sourceEnded = yield* Deferred.make<void>()
        const stopSignal = yield* Deferred.make<TripEndReason>()
        const startedAt = yield* now
        let lastRunningAt = startedAt
        let lastRpm: number | undefined
        let tripId = ""

        const observe = (e: {
          readonly _tag: string
          readonly sample?: {
            readonly ts: number
            readonly rpm?: number | undefined
            readonly voltageV?: number | undefined
          }
        }) =>
          Effect.gen(function* () {
            if (e._tag !== "Reading" || e.sample === undefined) return
            const { ts, rpm, voltageV } = e.sample
            let changed = false
            if (rpm !== undefined) {
              lastRpm = rpm
              if (rpm > START_RPM) lastRunningAt = ts
              changed = tracker.rpm(ts, rpm).length > 0
            }
            if (tracker.voltage(ts, voltageV).length > 0) changed = true
            if (changed && tripId !== "") yield* writeBattery(tripId, tracker)
          })

        const source: ReadingSource = {
          readings: () =>
            session
              .readings({ intervalMs: opts.readingsIntervalMs ?? 1000 })
              .pipe(Stream.tap(observe), Stream.ensuring(Deferred.succeed(sourceEnded, undefined)))
        }

        const started = yield* Effect.result(
          recorder.start({
            source,
            info: toReadingInfo(session.info),
            geo: opts.geo ?? false,
            ...(opts.appVersion !== undefined ? { appVersion: opts.appVersion } : {})
          })
        )
        if (started._tag === "Failure") {
          if (decision.reply !== undefined) yield* Deferred.fail(decision.reply, started.failure)
          detector.adoptRunning(startedAt)
          return undefined
        }
        tripId = started.success
        activeTripId = tripId
        if (decision.reply !== undefined) yield* Deferred.succeed(decision.reply, tripId)
        const report = tracker.report()
        yield* store
          .updateManifest(tripId, (m) => ({
            ...m,
            trigger: decision.trigger,
            ...(nonEmpty(report) ? { battery: report } : {})
          }))
          .pipe(Effect.ignore)
        yield* SubscriptionRef.set(battery, report)
        const adapterName = session.info.adapterName
        yield* setState(
          AutoState.Recording({ tripId, startedAt, trigger: decision.trigger, adapterName, linkLost: undefined })
        )

        const scanStart = yield* Effect.forkIn(Effect.ignore(runScan(session, "trip_start", tripId)), layerScope)

        const timer = yield* Effect.forkIn(
          Effect.forever(
            Effect.gen(function* () {
              yield* Effect.sleep("500 millis")
              const t = yield* now
              const cmd = yield* Queue.poll(commands)
              if (cmd._tag === "Some") {
                if (cmd.value._tag === "Stop") {
                  yield* Deferred.succeed(cmd.value.reply, undefined)
                  yield* Deferred.succeed(stopSignal, "manual")
                } else {
                  yield* Deferred.fail(cmd.value.reply, new AutoNotConnected({ reason: "not_recording" }))
                }
              }
              if (decision.trigger === "auto" && t - lastRunningAt >= (opts.detector?.stopAfterMs ?? STOP_AFTER_MS)) {
                yield* Deferred.succeed(stopSignal, lastRpm !== undefined ? "engine_off" : "ecu_silent")
              }
            })
          ),
          layerScope
        )

        const reason = yield* Effect.raceFirst(
          Deferred.await(stopSignal),
          Deferred.await(sourceEnded).pipe(Effect.as<TripEndReason>("adapter_lost"))
        )
        yield* Fiber.interrupt(timer)
        yield* Fiber.interrupt(scanStart)
        const endedAt = yield* now
        yield* recorder.stop.pipe(Effect.ignore)
        tracker.markOff(endedAt)
        yield* store.updateManifest(tripId, (m) => ({ ...m, endReason: reason })).pipe(Effect.ignore)
        yield* writeBattery(tripId, tracker)
        detector.reset()
        activeTripId = null
        yield* setState(
          reason === "manual"
            ? AutoState.WaitingForEngine({ adapterName, rpm: undefined, voltageV: undefined, startingSince: undefined })
            : AutoState.AutoStopped({ tripId, startedAt, endedAt, reason })
        )
        if (reason !== "adapter_lost") {
          yield* Effect.ignore(runScan(session, "trip_end", tripId).pipe(Effect.timeoutOption("20 seconds")))
        }
        return reason
      })

    const watching = (session: ObdSession) =>
      Effect.gen(function* () {
        const detector = makeEngineDetector(opts.detector)
        const tracker = makeBatteryTracker()
        const adapterName = session.info.adapterName
        let ecuSince: number | undefined
        while (true) {
          let decision: Decision | undefined
          yield* session.watch({ intervalMs: opts.watchIntervalMs ?? 500 }).pipe(
            Stream.runForEachWhile((tick: WatchTick) =>
              Effect.gen(function* () {
                for (const v of tick.voltages) tracker.voltage(v.ts, v.volts)
                const events = tracker.rpm(tick.ts, tick.rpm)
                if (events.length > 0) yield* SubscriptionRef.set(battery, tracker.report())
                const signal = detector.observe(tick.ts, tick.rpm)
                const lastV = tick.voltages[tick.voltages.length - 1]?.volts
                const responding = session.ecuIdentified && tick.ecuResponding
                if (!responding) {
                  ecuSince ??= tick.ts
                  yield* SubscriptionRef.update(state, (s) =>
                    s._tag === "AutoStopped"
                      ? s
                      : AutoState.EcuNotResponding({ since: ecuSince as number, adapterName })
                  )
                } else {
                  ecuSince = undefined
                  yield* SubscriptionRef.update(state, (s) =>
                    s._tag === "AutoStopped" || s._tag === "Recording"
                      ? s
                      : AutoState.WaitingForEngine({
                          adapterName,
                          rpm: tick.rpm,
                          voltageV: lastV,
                          startingSince: detector.startingSince()
                        })
                  )
                }
                const cmd = yield* Queue.poll(commands)
                if (cmd._tag === "Some") {
                  if (cmd.value._tag === "Start") {
                    if (!responding) {
                      yield* Deferred.fail(cmd.value.reply, new AutoNotConnected({ reason: "ecu_not_responding" }))
                    } else {
                      decision = { trigger: "manual", reply: cmd.value.reply }
                      return false
                    }
                  } else {
                    yield* Deferred.fail(cmd.value.reply, new AutoNotConnected({ reason: "not_recording" }))
                  }
                }
                if (signal === "started" && responding) {
                  decision = { trigger: "auto", reply: undefined }
                  return false
                }
                return true
              })
            )
          )
          if (decision === undefined) return
          const reason = yield* recording(session, tracker, detector, decision)
          if (reason === "adapter_lost") return yield* Effect.fail(new Disconnected())
        }
      })

    const sessionPhase = (target: ConnectTarget, attempt: number) =>
      Effect.scoped(
        Effect.gen(function* () {
          let connecting = true
          const since = yield* now
          yield* setState(
            target._tag === "Remembered"
              ? AutoState.Reconnecting({ attempt, since })
              : AutoState.Connecting({ deviceName: target.picked.name, step: 0, total: 0 })
          )
          const session = yield* connector.connect(target, {
            ...(opts.reconnect !== undefined ? { reconnect: opts.reconnect } : {}),
            onState: (s) => {
              if (connecting && s._tag === "InitializingAdapter") {
                Effect.runSync(
                  setState(
                    AutoState.Connecting({
                      deviceName: target._tag === "Picked" ? target.picked.name : undefined,
                      step: s.step,
                      total: s.total
                    })
                  )
                )
              }
            }
          })
          connecting = false
          established = true
          if (target._tag === "Picked") {
            yield* memory.set({ deviceId: target.picked.id, name: target.picked.name, rememberedAt: yield* now })
          }
          current = session
          yield* wake.hold
          yield* Effect.addFinalizer(() =>
            Effect.andThen(
              Effect.sync(() => void (current = undefined)),
              wake.unhold
            )
          )
          yield* Effect.forkScoped(
            SubscriptionRef.changes(session.state).pipe(
              Stream.runForEach((s) =>
                SubscriptionRef.update(state, (cur) => {
                  if (s._tag === "Lost") {
                    return cur._tag === "Recording"
                      ? AutoState.Recording({ ...cur, linkLost: { since: s.since, attempt: s.attempt } })
                      : cur._tag === "AutoStopped"
                        ? cur
                        : AutoState.Reconnecting({ attempt: s.attempt, since: s.since })
                  }
                  return cur._tag === "Recording" && cur.linkLost !== undefined
                    ? AutoState.Recording({ ...cur, linkLost: undefined })
                    : cur
                })
              )
            )
          )
          yield* Effect.forkScoped(
            lifecycle.visibility.pipe(
              Stream.runForEach((v) => (v === "visible" ? Effect.asVoid(wake.hold) : Effect.void))
            )
          )
          yield* watching(session)
        })
      )

    const waitForTap = (reason: NeedsTapReason) =>
      setState(AutoState.NeedsTap({ reason })).pipe(Effect.andThen(Queue.take(taps)))

    const mainLoop = Effect.gen(function* () {
      let target: ConnectTarget | undefined
      let attempts = 0
      const baseMs = opts.retryBaseMs ?? 5000
      const maxMs = opts.retryMaxMs ?? 60_000
      while (true) {
        if (target === undefined) {
          const remembered: RememberedAdapter | undefined = yield* memory.get
          if (remembered === undefined) target = { _tag: "Picked", picked: yield* waitForTap("first_use") }
          else {
            const support = yield* connector.support
            target = support.getDevices
              ? { _tag: "Remembered", adapter: remembered }
              : { _tag: "Picked", picked: yield* waitForTap("unsupported") }
          }
        }
        yield* Queue.clear(taps)
        const outcome = yield* Effect.result(sessionPhase(target, attempts + 1))
        const failure = outcome._tag === "Failure" ? outcome.failure : undefined
        const tag = failure?._tag
        if (failure !== undefined && failure._tag === "ReconnectUnavailable") {
          const reason = failure.reason
          if (reason === "out_of_range") {
            attempts += 1
            const delay = Math.min(maxMs, baseMs * 2 ** (attempts - 1))
            const at = yield* now
            yield* setState(AutoState.AdapterNotFound({ since: at, attempts, nextRetryAt: at + delay }))
            const tapped = yield* Effect.raceFirst(Effect.sleep(delay).pipe(Effect.as(undefined)), Queue.take(taps))
            if (tapped !== undefined) target = { _tag: "Picked", picked: tapped }
            continue
          }
          if (reason === "forgotten") yield* memory.clear
          const tapReason: NeedsTapReason =
            reason === "forgotten" ? "forgotten" : reason === "unsupported" ? "unsupported" : "gesture_required"
          target = { _tag: "Picked", picked: yield* waitForTap(tapReason) }
          attempts = 0
          continue
        }
        if (tag === "PermissionDenied" || tag === "DeviceNotSelected") {
          target = {
            _tag: "Picked",
            picked: yield* waitForTap(tag === "DeviceNotSelected" ? "first_use" : "permission_denied")
          }
          attempts = 0
          continue
        }
        if (failure !== undefined && failure._tag === "BluetoothUnavailable") {
          yield* setState(AutoState.Unavailable({ error: failure }))
          target = { _tag: "Picked", picked: yield* Queue.take(taps) }
          attempts = 0
          continue
        }
        const adapter = yield* memory.get
        if (adapter !== undefined && target._tag === "Picked" && established) target = { _tag: "Remembered", adapter }
        if (established) {
          established = false
          attempts = 0
          continue
        }
        attempts += 1
        const delay = Math.min(maxMs, baseMs * 2 ** Math.min(attempts - 1, 10))
        const at = yield* now
        yield* setState(AutoState.AdapterNotFound({ since: at, attempts, nextRetryAt: at + delay }))
        const tapped = yield* Effect.raceFirst(Effect.sleep(delay).pipe(Effect.as(undefined)), Queue.take(taps))
        if (tapped !== undefined) target = { _tag: "Picked", picked: tapped }
      }
    })

    const enable = (options: AutoOptions = {}) =>
      Effect.gen(function* () {
        opts = options
        if (fiber !== undefined) return
        fiber = yield* Effect.forkIn(mainLoop.pipe(Effect.catch(() => Effect.void)), layerScope)
      })

    const disable = Effect.gen(function* () {
      const f = fiber
      fiber = undefined
      if (f !== undefined) yield* Fiber.interrupt(f)
      yield* recorder.stop.pipe(Effect.ignore)
      current = undefined
      activeTripId = null
      yield* setState(AutoState.Off())
    })

    const request = <A>(make: (reply: Deferred.Deferred<A, AutoFailure>) => Command) =>
      Effect.gen(function* () {
        if (fiber === undefined) return yield* new AutoNotConnected({ reason: "disabled" })
        if (current === undefined) return yield* new AutoNotConnected({ reason: "no_session" })
        const reply = yield* Deferred.make<A, AutoFailure>()
        yield* Queue.offer(commands, make(reply))
        return yield* Deferred.await(reply)
      })

    return AutoRecorder.of({
      state,
      codes,
      battery,
      enable,
      disable,
      connectNew: connector.pick.pipe(
        Effect.flatMap((p) => Queue.offer(taps, p)),
        Effect.asVoid
      ),
      startNow: request<string>((reply) => ({ _tag: "Start", reply })),
      stopNow: request<void>((reply) => ({ _tag: "Stop", reply })),
      scanNow: Effect.suspend(() =>
        current === undefined
          ? Effect.fail<AutoFailure>(new AutoNotConnected({ reason: "no_session" }))
          : runScan(current, "manual", activeTripId)
      ),
      dismissStopped: SubscriptionRef.update(state, (s) =>
        s._tag === "AutoStopped"
          ? AutoState.WaitingForEngine({
              adapterName: current?.info.adapterName ?? "",
              rpm: undefined,
              voltageV: undefined,
              startingSince: undefined
            })
          : s
      ),
      forgetAdapter: memory.clear
    })
  })
)
