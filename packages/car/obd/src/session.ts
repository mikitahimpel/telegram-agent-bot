import type { Cause } from "effect"
import { Clock, Data, Exit, Effect, Queue, Scope, Stream, SubscriptionRef } from "effect"
import type { Gap } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import {
  connectEcu,
  type Elm327,
  initAdapter,
  INIT_TOTAL,
  makeElm327,
  readSupportedPids,
  readVin
} from "./elm327.ts"
import { Disconnected, type ObdError } from "./errors.ts"
import {
  type FuelRateSource,
  fuelLphFromMaf,
  fuelRateSourceFor,
  parseVoltage,
  PIDS,
  protocolName
} from "./pids.ts"
import { ConnectionState } from "./state.ts"
import { bleTransport, type ObdTransport, serialTransport, simulatorTransport } from "./transport.ts"
import type { SimulatorScenario } from "./transport.ts"

export interface SessionInfo {
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

export interface ObdSession {
  readonly info: SessionInfo
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>
  readonly readings: (opts?: { readonly intervalMs?: number }) => Stream.Stream<ObdEvent, ObdError>
}

export interface ConnectOptions {
  readonly scenario?: SimulatorScenario
  readonly unsupported?: ReadonlyArray<string>
  readonly baudRate?: number
  readonly namePrefix?: string
  readonly reconnect?: {
    /** Give up and fail with `Disconnected` after this long; default 5 min. */
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
    const setState = (s: ConnectionState) => SubscriptionRef.set(state, s)

    interface Link {
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
      const open =
        kind === "ble"
          ? bleTransport(options.namePrefix !== undefined ? { namePrefix: options.namePrefix } : undefined)
          : kind === "serial"
          ? serialTransport(options.baudRate !== undefined ? { baudRate: options.baudRate } : undefined)
          : simulatorTransport(options.scenario ?? "normal", { unsupported: options.unsupported ?? [] })
      let link = yield* openLink(open)
      yield* setState(ConnectionState.Connecting({ deviceName: link.transport.name }))

      const init = yield* initAdapter(link.elm, (step, total, label) =>
        setState(ConnectionState.InitializingAdapter({ step, total, label })))
      yield* setState(ConnectionState.WaitingForEcu())
      const first = yield* connectEcu(link.elm)
      const supportedPids = yield* readSupportedPids(link.elm, first)
      const dpn = yield* link.elm.send("ATDPN").pipe(
        Effect.map((l) => l[0] ?? ""),
        Effect.catchTag("CommandTimeout", () => Effect.succeed(""))
      )
      const vin = yield* readVin(link.elm)

      const info: SessionInfo = {
        adapterName: link.transport.name,
        elmVersion: init.elmVersion,
        obdProtocol: protocolName(dpn),
        vin,
        supportedPids,
        fuelRateSource: fuelRateSourceFor(supportedPids),
        transport: kind
      }
      yield* setState(ConnectionState.Ready({ info }))

      const reconnectOnce = Effect.gen(function*() {
        yield* Scope.close(link.scope, Exit.void)
        const next = yield* openLink(link.transport.reopen)
        const ready = yield* Effect.gen(function*() {
          yield* initAdapter(next.elm)
          yield* connectEcu(next.elm)
        }).pipe(Effect.onError(() => Scope.close(next.scope, Exit.void)))
        void ready
        link = next
      })

      const reconnectCfg = options.reconnect ?? {}
      const maxMs = reconnectCfg.maxMs ?? 300_000
      const baseDelay = reconnectCfg.baseDelayMs ?? 1000
      const maxDelay = reconnectCfg.maxDelayMs ?? 30_000

      type Emit = (e: ObdEvent) => Effect.Effect<unknown>

      /** Emits GapStarted, retries with exponential backoff, emits GapEnded; fails with Disconnected after `maxMs`. */
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
          const emit: Emit = (e) => Queue.offer(queue, e)
          const supported = new Set(supportedPids)
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

      const session: ObdSession = {
        info,
        state,
        readings: (opts) =>
          Stream.callback<ObdEvent, ObdError>((queue) =>
            Effect.forkScoped(
              poll(queue, opts?.intervalMs ?? 1000).pipe(Effect.catch((e: ObdError) => Queue.fail(queue, e)))
            )
          )
      }
      return session
    })

    return yield* body.pipe(Effect.tapError((error) => setState(ConnectionState.Failed({ error }))))
  })

export { INIT_TOTAL }
