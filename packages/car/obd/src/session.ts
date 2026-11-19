import type { Cause } from "effect"
import { Clock, Data, Exit, Effect, Queue, Scope, Stream, SubscriptionRef } from "effect"
import type { Gap } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import { type DtcScan, type DtcWireStyle, readDtcScan } from "./dtc.ts"
import {
  connectEcu,
  type Elm327,
  initAdapter,
  INIT_TOTAL,
  makeElm327,
  readSupportedPids,
  readVin,
  readVoltage
} from "./elm327.ts"
import { Disconnected, type EcuNotResponding, type ObdError } from "./errors.ts"
import {
  type FuelRateSource,
  fuelLphFromMaf,
  fuelRateSourceFor,
  isCanProtocol,
  parseVoltage,
  PIDS,
  protocolName
} from "./pids.ts"
import { ConnectionState } from "./state.ts"
import { bleOpenDevice, bleOpenRemembered, bleTransport, type ObdTransport, serialTransport, simulatorTransport } from "./transport.ts"
import type { SimCar, SimulatorScenario } from "./transport.ts"

export type SessionInfo = {
  readonly adapterName: string
  readonly elmVersion: string
  readonly obdProtocol: string
  readonly vin?: string | undefined
  readonly supportedPids: ReadonlyArray<string>
  readonly fuelRateSource: FuelRateSource
  readonly transport: "ble" | "serial" | "simulator"
}

export type ObdSample = Omit<Sample, "lat" | "lon" | "gpsAccuracyM" | "gpsSpeedKmh">

export type ObdEvent = Data.TaggedEnum<{
  Reading: { readonly sample: ObdSample }
  GapStarted: { readonly at: number; readonly reason: Gap["reason"] }
  GapEnded: { readonly at: number }
}>
export const ObdEvent = Data.taggedEnum<ObdEvent>()

export type WatchTick = {
  readonly ts: number
  readonly rpm: number | undefined
  readonly ecuResponding: boolean
  readonly voltages: ReadonlyArray<{ readonly ts: number; readonly volts: number }>
}

export type WatchOptions = { readonly intervalMs?: number; readonly voltageBurst?: number }

export type ObdSession = {
  readonly info: SessionInfo
  readonly ecuIdentified: boolean
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>
  readonly readings: (opts?: { readonly intervalMs?: number }) => Stream.Stream<ObdEvent, ObdError>
  readonly watch: (opts?: WatchOptions) => Stream.Stream<WatchTick, ObdError>
  readonly scanDtc: Effect.Effect<DtcScan, EcuNotResponding | Disconnected>
  readonly readVoltage: Effect.Effect<number | undefined, Disconnected>
}

export type ConnectOptions = {
  readonly waitForEcu?: boolean
  readonly open?: Effect.Effect<ObdTransport, ObdError, Scope.Scope>
  readonly device?: BluetoothDevice
  readonly car?: SimCar
  readonly remembered?: { readonly deviceId: string; readonly advertisementWaitMs?: number }
  readonly onState?: (s: ConnectionState) => void
  readonly scenario?: SimulatorScenario
  readonly unsupported?: ReadonlyArray<string>
  readonly baudRate?: number
  readonly namePrefix?: string
  readonly reconnect?: {
    readonly maxMs?: number
    readonly baseDelayMs?: number
    readonly maxDelayMs?: number
  }
}

const SLOW_EVERY = 10
const ECU_SILENT_TICKS = 3

export const connect = (
  kind: "ble" | "serial" | "simulator",
  options: ConnectOptions = {}
): Effect.Effect<ObdSession, ObdError, Scope.Scope> =>
  Effect.gen(function*() {
    const sessionScope = yield* Effect.scope
    const state = yield* SubscriptionRef.make<ConnectionState>(ConnectionState.Idle())
    const setState = (s: ConnectionState) =>
      Effect.suspend(() => {
        options.onState?.(s)
        return SubscriptionRef.set(state, s)
      })

    type Link = {
      readonly scope: Scope.Closeable
      readonly transport: ObdTransport
      readonly elm: Elm327
    }

    const openLink = (open: Effect.Effect<ObdTransport, ObdError, Scope.Scope>): Effect.Effect<Link, ObdError> =>
      Effect.gen(function*() {
        const scope = yield* Scope.fork(sessionScope)
        return yield* Effect.gen(function*() {
          const transport = yield* open
          const elm = yield* makeElm327(transport)
          return { scope, transport, elm } satisfies Link
        }).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
      })

    const body = Effect.gen(function*() {
      yield* setState(ConnectionState.RequestingDevice())
      const open: Effect.Effect<ObdTransport, ObdError, Scope.Scope> =
        options.open !== undefined
          ? options.open
          : options.remembered !== undefined
          ? bleOpenRemembered(
            options.remembered.deviceId,
            options.remembered.advertisementWaitMs !== undefined
              ? { advertisementWaitMs: options.remembered.advertisementWaitMs }
              : {}
          )
          : options.device !== undefined
          ? bleOpenDevice(options.device)
          : kind === "ble"
          ? bleTransport(options.namePrefix !== undefined ? { namePrefix: options.namePrefix } : undefined)
          : kind === "serial"
          ? serialTransport(options.baudRate !== undefined ? { baudRate: options.baudRate } : undefined)
          : simulatorTransport(options.scenario ?? "normal", {
            unsupported: options.unsupported ?? [],
            ...(options.car !== undefined ? { car: options.car } : {})
          })
      let link = yield* openLink(open)
      yield* setState(ConnectionState.Connecting({ deviceName: link.transport.name }))

      const init = yield* initAdapter(link.elm, (step, total, label) =>
        setState(ConnectionState.InitializingAdapter({ step, total, label })))
      yield* setState(ConnectionState.WaitingForEcu())

      let dpn = ""
      const identify = (ecu: { readonly attempts?: number; readonly timeoutMs?: number }) =>
        Effect.gen(function*() {
          const first = yield* connectEcu(link.elm, ecu)
          const supportedPids = yield* readSupportedPids(link.elm, first)
          dpn = yield* link.elm.send("ATDPN").pipe(
            Effect.map((l) => l[0] ?? ""),
            Effect.catchTag("CommandTimeout", () => Effect.succeed(""))
          )
          const vin = yield* readVin(link.elm)
          return {
            adapterName: link.transport.name,
            elmVersion: init.elmVersion,
            obdProtocol: protocolName(dpn),
            vin,
            supportedPids,
            fuelRateSource: fuelRateSourceFor(supportedPids),
            transport: kind
          } satisfies SessionInfo
        })

      let info: SessionInfo = {
        adapterName: link.transport.name,
        elmVersion: init.elmVersion,
        obdProtocol: "",
        supportedPids: [],
        fuelRateSource: "none",
        transport: kind
      }
      let identified = false
      const identifyNow = options.waitForEcu === true ? identify({ attempts: 1, timeoutMs: 6000 }) : identify({})
      const first = yield* Effect.result(identifyNow)
      if (first._tag === "Success") {
        info = first.success
        identified = true
        yield* setState(ConnectionState.Ready({ info }))
      } else if (options.waitForEcu !== true || first.failure._tag !== "EcuNotResponding") {
        return yield* first.failure
      }

      const ensureIdentified: Effect.Effect<void, ObdError> = Effect.suspend(() => {
        if (identified) return Effect.void
        return identify({ attempts: 1, timeoutMs: 6000 }).pipe(
          Effect.flatMap((next) =>
            Effect.suspend(() => {
              info = next
              identified = true
              return setState(ConnectionState.Ready({ info }))
            })
          )
        )
      })

      const lockProtocol = Effect.suspend(() => {
        const code = dpn.trim().toUpperCase().replace(/^A(?=[0-9A-C]$)/, "")
        return /^[1-9A-C]$/.test(code)
          ? link.elm.send(`ATSP${code}`, { timeoutMs: 2000 }).pipe(Effect.ignore)
          : Effect.void
      })

      const wireStyle = (): DtcWireStyle => (dpn === "" ? "auto" : isCanProtocol(dpn) ? "can" : "legacy")

      const reconnectOnce = Effect.gen(function*() {
        yield* Scope.close(link.scope, Exit.void)
        const next = yield* openLink(link.transport.reopen)
        const ready = yield* Effect.gen(function*() {
          yield* initAdapter(next.elm)
          if (options.waitForEcu !== true) yield* connectEcu(next.elm)
        }).pipe(Effect.onError(() => Scope.close(next.scope, Exit.void)))
        void ready
        link = next
      })

      const reconnectCfg = options.reconnect ?? {}
      const maxMs = reconnectCfg.maxMs ?? 300_000
      const baseDelay = reconnectCfg.baseDelayMs ?? 1000
      const maxDelay = reconnectCfg.maxDelayMs ?? 30_000

      type Emit = (e: ObdEvent) => Effect.Effect<unknown>

      const recover = (emit: Emit): Effect.Effect<void, ObdError> =>
        Effect.gen(function*() {
          const since = yield* Clock.currentTimeMillis
          yield* emit(ObdEvent.GapStarted({ at: since, reason: "adapter_disconnected" }))
          let attempt = 0
          while (true) {
            attempt++
            const now = yield* Clock.currentTimeMillis
            const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1))
            yield* setState(ConnectionState.Lost({ since, attempt, nextRetryAt: now + delay }))
            yield* Effect.sleep(delay)
            const outcome = yield* reconnectOnce.pipe(Effect.map(() => true), Effect.orElseSucceed(() => false))
            const after = yield* Clock.currentTimeMillis
            if (outcome) {
              yield* setState(ConnectionState.Ready({ info }))
              yield* emit(ObdEvent.GapEnded({ at: after }))
              return
            }
            if (after - since >= maxMs) {
              const error = new Disconnected()
              yield* setState(ConnectionState.Failed({ error }))
              return yield* error
            }
          }
        })

      const poll = (queue: Queue.Queue<ObdEvent, ObdError | Cause.Done>, baseInterval: number) =>
        Effect.gen(function*() {
          yield* ensureIdentified
          const emit: Emit = (e) => Queue.offer(queue, e)
          const supported = new Set(info.supportedPids)
          const polled = PIDS.filter((p) => supported.has(p.pid))
          const fast = polled.filter((p) => !p.slow)
          const wantsRv = !supported.has("42")
          let tick = 0
          let slowEvery = SLOW_EVERY
          let silent = 0
          let inEcuGap = false

          while (true) {
            const t0 = yield* Clock.currentTimeMillis
            const slowTick = tick % slowEvery === 0
            const targets = slowTick ? polled : fast
            const sample: Record<string, number> = {}
            let answered = 0
            const lost = yield* Effect.gen(function*() {
              for (const p of targets) {
                const bytes = yield* link.elm.mode01(p.pid).pipe(
                  Effect.catch((e) => (e._tag === "Disconnected" ? Effect.fail(e) : Effect.succeed(undefined)))
                )
                if (bytes !== undefined && bytes.length >= p.bytes) {
                  sample[p.key] = p.decode(bytes)
                  answered++
                }
              }
              if (slowTick && wantsRv) {
                const v = yield* link.elm.query("ATRV").pipe(
                  Effect.map((l) => parseVoltage(l.join(" "))),
                  Effect.catch((e) => (e._tag === "Disconnected" ? Effect.fail(e) : Effect.succeed(undefined)))
                )
                if (v !== undefined) sample["voltageV"] = v
              }
              return false
            }).pipe(Effect.catchTag("Disconnected", () => Effect.succeed(true)))

            if (lost) {
              yield* recover(emit)
              silent = 0
              inEcuGap = false
              tick++
              continue
            }

            if (info.fuelRateSource === "maf_estimate" && sample["mafGps"] !== undefined) {
              sample["fuelRateLph"] = fuelLphFromMaf(sample["mafGps"])
            }

            if (answered > 0) {
              silent = 0
              if (inEcuGap) {
                inEcuGap = false
                yield* emit(ObdEvent.GapEnded({ at: t0 }))
              }
              yield* emit(ObdEvent.Reading({ sample: { ts: t0, ...sample } as ObdSample }))
            } else if (targets.length > 0) {
              silent++
              if (silent === ECU_SILENT_TICKS && !inEcuGap) {
                inEcuGap = true
                yield* emit(ObdEvent.GapStarted({ at: t0, reason: "ecu_no_response" }))
              }
            }

            const elapsed = (yield* Clock.currentTimeMillis) - t0
            slowEvery = elapsed > baseInterval ? SLOW_EVERY * 3 : SLOW_EVERY
            tick++
            if (elapsed < baseInterval) yield* Effect.sleep(baseInterval - elapsed)
          }
        })

      const watchLoop = (queue: Queue.Queue<WatchTick, ObdError | Cause.Done>, opts: WatchOptions) =>
        Effect.gen(function*() {
          const interval = opts.intervalMs ?? 500
          const burst = opts.voltageBurst ?? 3
          const none: Emit = () => Effect.void
          let locked = false
          while (true) {
            const t0 = yield* Clock.currentTimeMillis
            const step = Effect.gen(function*() {
              if (!identified) {
                const attempt = yield* Effect.result(ensureIdentified)
                if (attempt._tag === "Failure" && attempt.failure._tag === "Disconnected") return yield* attempt.failure
              }
              if (identified && !locked) {
                yield* lockProtocol
                locked = true
              }
              const voltages: Array<{ ts: number; volts: number }> = []
              const readV = Effect.gen(function*() {
                const v = yield* readVoltage(link.elm)
                if (v !== undefined) voltages.push({ ts: yield* Clock.currentTimeMillis, volts: v })
              })
              yield* readV
              let rpm: number | undefined
              if (identified) {
                const bytes = yield* link.elm.mode01("0C", { timeoutMs: 2000 }).pipe(
                  Effect.catch((e) => (e._tag === "Disconnected" ? Effect.fail(e) : Effect.succeed(undefined)))
                )
                if (bytes !== undefined && bytes.length >= 2) rpm = ((bytes[0] as number) * 256 + (bytes[1] as number)) / 4
              }
              for (let i = 1; i < burst; i++) yield* readV
              return { ts: t0, rpm, ecuResponding: rpm !== undefined, voltages } satisfies WatchTick
            }).pipe(Effect.catchTag("Disconnected", () => Effect.succeed(undefined)))
            const tick = yield* step
            if (tick === undefined) {
              yield* recover(none)
              locked = false
              continue
            }
            yield* Queue.offer(queue, tick)
            const elapsed = (yield* Clock.currentTimeMillis) - t0
            if (elapsed < interval) yield* Effect.sleep(interval - elapsed)
          }
        })

      const session: ObdSession = {
        get info() {
          return info
        },
        get ecuIdentified() {
          return identified
        },
        state,
        readings: (opts) =>
          Stream.callback<ObdEvent, ObdError>((queue) =>
            Effect.forkScoped(
              poll(queue, opts?.intervalMs ?? 1000).pipe(Effect.catch((e: ObdError) => Queue.fail(queue, e)))
            )
          ),
        watch: (opts = {}) =>
          Stream.callback<WatchTick, ObdError>((queue) =>
            Effect.forkScoped(watchLoop(queue, opts).pipe(Effect.catch((e: ObdError) => Queue.fail(queue, e))))
          ),
        scanDtc: Effect.suspend(() => readDtcScan(link.elm, wireStyle())),
        readVoltage: Effect.suspend(() => readVoltage(link.elm))
      }
      return session
    })

    return yield* body.pipe(Effect.tapError((error) => setState(ConnectionState.Failed({ error }))))
  })

export { INIT_TOTAL }
