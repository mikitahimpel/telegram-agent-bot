import { Deferred, Effect, Fiber, Scope, Semaphore, Stream } from "effect"
import {
  AdapterNotResponding,
  CommandRejected,
  CommandTimeout,
  Disconnected,
  EcuNotResponding,
  type ObdError
} from "./errors.ts"
import { parseSupportedMask } from "./pids.ts"
import type { ObdTransport } from "./transport.ts"

export interface SendOptions {
  readonly timeoutMs?: number
}

export interface Elm327 {
  readonly transport: ObdTransport
  /** One command in flight; returns cleaned reply lines (echo and SEARCHING... removed). Error tokens are NOT checked. */
  readonly send: (command: string, options?: SendOptions) => Effect.Effect<ReadonlyArray<string>, CommandTimeout | Disconnected>
  /** `send` + error token detection: fails with `CommandRejected`. */
  readonly query: (command: string, options?: SendOptions) => Effect.Effect<ReadonlyArray<string>, CommandTimeout | Disconnected | CommandRejected>
  /** Mode 01 PID: returns the data bytes after `41 <pid>`. */
  readonly mode01: (pid: string, options?: SendOptions) => Effect.Effect<ReadonlyArray<number>, CommandTimeout | Disconnected | CommandRejected>
}

export const DEFAULT_TIMEOUT_MS = 2000

const norm = (s: string): string => s.replace(/\s/g, "").toUpperCase()

const ERROR_TOKEN = /^(NODATA|UNABLETOCONNECT|CANERROR|BUFFERFULL|STOPPED|\?|ERR\d+|BUSBUSY|BUSERROR|DATAERROR|FBERROR|RXERROR|ACTALERT|LVRESET)$/

/** Returns the error token in a cleaned reply, if any (e.g. "NODATA", "BUSINIT:ERROR"). */
export const findErrorToken = (lines: ReadonlyArray<string>): string | undefined => {
  for (const line of lines) {
    const n = norm(line)
    if (ERROR_TOKEN.test(n)) return n
    if (n.includes("BUSINIT") && n.includes("ERROR")) return n
  }
  return undefined
}

/** Replies with non-printable bytes come from clone adapters that are mid-reset or at the wrong baud rate. */
export const isGarbage = (lines: ReadonlyArray<string>): boolean => lines.some((l) => /[^\x20-\x7e]/.test(l))

export const cleanReply = (raw: string, command: string): string[] => {
  const cmd = norm(command)
  return raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && norm(l) !== cmd && !/^SEARCHING/i.test(l))
}

export const hexToBytes = (hex: string): number[] => {
  const out: number[] = []
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const v = parseInt(hex.slice(i, i + 2), 16)
    if (Number.isNaN(v)) break
    out.push(v)
  }
  return out
}

/** Data bytes of a mode-01 reply: finds the line starting with `41<pid>`. */
export const parseMode01 = (lines: ReadonlyArray<string>, pid: string): number[] | undefined => {
  const prefix = "41" + pid.toUpperCase()
  for (const line of lines) {
    const n = norm(line).replace(/^[0-9A-F]:/, "")
    const at = n.indexOf(prefix)
    if (at >= 0 && /^[0-9A-F]*$/.test(n)) return hexToBytes(n.slice(at + prefix.length))
  }
  return undefined
}

/**
 * Parses the VIN from a `0902` reply. Handles CAN ISO-TP multi-frame (`014` length line, `0:` `1:` `2:` frames)
 * and per-line K-line style (`49 02 01 ...`, `49 02 02 ...`).
 */
export const parseVin = (lines: ReadonlyArray<string>): string | undefined => {
  const n = lines.map(norm)
  let bytes: number[]
  const frames = n.filter((l) => /^[0-9A-F]:/.test(l)).sort((a, b) => (a[0] as string).localeCompare(b[0] as string))
  if (frames.length > 0) {
    const all = hexToBytes(frames.map((f) => f.slice(2)).join(""))
    const at = all.findIndex((b, i) => b === 0x49 && all[i + 1] === 0x02)
    if (at < 0) return undefined
    bytes = all.slice(at + 3)
  } else {
    const rows = n
      .filter((l) => l.startsWith("4902") && /^[0-9A-F]+$/.test(l))
      .map((l) => hexToBytes(l))
      .sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0))
    bytes = rows.flatMap((r) => r.slice(3))
  }
  const vin = bytes
    .filter((b) => b >= 0x30 && b <= 0x5a && b !== 0x3a)
    .map((b) => String.fromCharCode(b))
    .join("")
    .slice(-17)
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : undefined
}

/** Starts reading the transport; `send` serialises commands and frames replies on the `>` prompt. */
export const makeElm327 = (transport: ObdTransport): Effect.Effect<Elm327, never, Scope.Scope> =>
  Effect.gen(function*() {
    const gate = yield* Semaphore.make(1)
    let buffer = ""
    let pending: Deferred.Deferred<string, Disconnected> | undefined
    let dead = false
    let resyncState: { need: number; count: number; done: Deferred.Deferred<void> } | undefined

    const markDead = Effect.sync(() => {
      dead = true
      if (pending !== undefined) Deferred.doneUnsafe(pending, Effect.fail(new Disconnected()))
    })

    yield* Effect.forkScoped(
      Stream.runForEach(transport.incoming, (chunk) =>
        Effect.sync(() => {
          buffer += chunk
          let end = buffer.indexOf(">")
          while (end >= 0) {
            const text = buffer.slice(0, end)
            buffer = buffer.slice(end + 1)
            if (resyncState !== undefined) {
              resyncState.count++
              if (resyncState.count >= resyncState.need) Deferred.doneUnsafe(resyncState.done, Effect.void)
            } else if (pending !== undefined) {
              Deferred.doneUnsafe(pending, Effect.succeed(text))
            }
            end = buffer.indexOf(">")
          }
        })).pipe(Effect.catch(() => Effect.void), Effect.andThen(markDead))
    )

    /**
     * After a timeout the late reply (and its prompt) may still arrive. Send a bare CR and swallow input
     * until two prompts have been seen (the stale one and the answer to CR); if they don't both come
     * within 1.5 s, send ATE0 once and swallow its prompt. Only then is the next command dispatched.
     */
    const awaitPrompts = (need: number, ms: number) =>
      Effect.gen(function*() {
        const done = yield* Deferred.make<void>()
        buffer = ""
        pending = undefined
        resyncState = { need, count: 0, done }
        return yield* Deferred.await(done).pipe(Effect.timeoutOption(ms), Effect.map((o) => o._tag === "Some"))
      })

    const resync = Effect.gen(function*() {
      const waiting = yield* Effect.forkChild(awaitPrompts(2, 1500))
      yield* Effect.yieldNow
      yield* transport.write("")
      const ok = yield* Fiber.join(waiting)
      if (!ok) {
        const retry = yield* Effect.forkChild(awaitPrompts(1, 3000))
        yield* Effect.yieldNow
        yield* transport.write("ATE0")
        yield* Fiber.join(retry)
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          resyncState = undefined
          buffer = ""
        })
      )
    )

    const send: Elm327["send"] = (command, options) =>
      gate.withPermit(
        Effect.gen(function*() {
          if (dead) return yield* new Disconnected()
          const reply = yield* Deferred.make<string, Disconnected>()
          buffer = ""
          pending = reply
          yield* transport.write(command)
          const raw = yield* Deferred.await(reply).pipe(Effect.timeoutOption(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS))
          if (raw._tag === "None") {
            yield* resync
            return yield* new CommandTimeout({ command })
          }
          return cleanReply(raw.value, command)
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              pending = undefined
            })
          )
        )
      )

    const query: Elm327["query"] = (command, options) =>
      Effect.flatMap(send(command, options), (lines) => {
        const token = findErrorToken(lines)
        return token === undefined ? Effect.succeed(lines) : Effect.fail(new CommandRejected({ command, token }))
      })

    const mode01: Elm327["mode01"] = (pid, options) =>
      Effect.flatMap(query(`01${pid}`, options), (lines) => {
        const bytes = parseMode01(lines, pid)
        return bytes === undefined
          ? Effect.fail(new CommandRejected({ command: `01${pid}`, token: "UNEXPECTED_REPLY" }))
          : Effect.succeed(bytes)
      })

    return { transport, send, query, mode01 }
  })

export interface AdapterInit {
  readonly elmVersion: string
}

export const INIT_STEPS = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0", "ATAT1"] as const
export const INIT_TOTAL = INIT_STEPS.length

const requiredSteps = new Set<string>(["ATE0", "ATSP0"])

/**
 * ATZ with fallbacks for clones: on garbage, error or timeout, try `ATWS` then `ATD` first, with a pause.
 */
const resetAdapter = (elm: Elm327): Effect.Effect<string, AdapterNotResponding | Disconnected> =>
  Effect.gen(function*() {
    const prefixes: ReadonlyArray<string | undefined> = [undefined, "ATWS", "ATD"]
    let last = ""
    for (const prefix of prefixes) {
      if (prefix !== undefined) {
        yield* Effect.sleep("500 millis")
        yield* elm.send(prefix, { timeoutMs: 3000 }).pipe(
          Effect.catchTag("CommandTimeout", () => Effect.void)
        )
      }
      const lines = yield* elm.send("ATZ", { timeoutMs: 4000 }).pipe(
        Effect.catchTag("CommandTimeout", () => Effect.succeed([] as ReadonlyArray<string>))
      )
      last = lines.join(" ")
      if (lines.length > 0 && !isGarbage(lines) && findErrorToken(lines) === undefined) {
        return lines.find((l) => /ELM|ELS|OBD/i.test(l)) ?? (lines[0] as string)
      }
    }
    return yield* new AdapterNotResponding({ step: "ATZ", lastResponse: last === "" ? "timeout" : last })
  })

/** Runs the adapter init sequence, reporting progress as (step 1-based, total, command). */
export const initAdapter = (
  elm: Elm327,
  report: (step: number, total: number, label: string) => Effect.Effect<void> = () => Effect.void
): Effect.Effect<AdapterInit, AdapterNotResponding | Disconnected> =>
  Effect.gen(function*() {
    let elmVersion = ""
    for (let i = 0; i < INIT_STEPS.length; i++) {
      const step = INIT_STEPS[i] as string
      yield* report(i + 1, INIT_TOTAL, step)
      if (step === "ATZ") {
        elmVersion = yield* resetAdapter(elm)
        continue
      }
      const result = yield* elm.query(step, { timeoutMs: 3000 }).pipe(
        Effect.map(() => undefined),
        Effect.catch((e: CommandTimeout | Disconnected | CommandRejected) =>
          e._tag === "Disconnected"
            ? Effect.fail(e)
            : Effect.succeed(e._tag === "CommandTimeout" ? "timeout" : e.token)
        )
      )
      if (result !== undefined && requiredSteps.has(step)) {
        return yield* new AdapterNotResponding({ step, lastResponse: result })
      }
    }
    return { elmVersion }
  })

const RETRYABLE = /^(NODATA|UNABLETOCONNECT|STOPPED|CANERROR|BUSBUSY|BUSERROR|DATAERROR|FBERROR|BUSINIT.*)$/
const ECU_ATTEMPTS = 3

/**
 * Sends `0100` until the ECU answers (the first one triggers protocol search and can take seconds).
 * Persistent NO DATA / UNABLE TO CONNECT / BUS INIT ERROR → `EcuNotResponding` (ignition is off).
 */
export const connectEcu = (elm: Elm327): Effect.Effect<ReadonlyArray<string>, EcuNotResponding | AdapterNotResponding | Disconnected> =>
  Effect.gen(function*() {
    let last = ""
    for (let attempt = 1; attempt <= ECU_ATTEMPTS; attempt++) {
      if (attempt > 1) yield* Effect.sleep("1 second")
      const outcome: { bytes?: ReadonlyArray<number>; token?: string } = yield* elm.mode01("00", { timeoutMs: 10_000 }).pipe(
        Effect.map((bytes): { bytes?: ReadonlyArray<number>; token?: string } => ({ bytes })),
        Effect.catch((e: CommandTimeout | Disconnected | CommandRejected): Effect.Effect<{ bytes?: ReadonlyArray<number>; token?: string }, Disconnected> => {
          if (e._tag === "Disconnected") return Effect.fail(e)
          if (e._tag === "CommandTimeout") return Effect.succeed({ token: "TIMEOUT" })
          return Effect.succeed({ token: e.token })
        })
      )
      if (outcome.bytes !== undefined) return parseSupportedMask(0x00, outcome.bytes)
      last = outcome.token ?? ""
      if (last === "?") return yield* new AdapterNotResponding({ step: "0100", lastResponse: last })
      if (last !== "TIMEOUT" && !RETRYABLE.test(last)) {
        return yield* new AdapterNotResponding({ step: "0100", lastResponse: last })
      }
    }
    return yield* new EcuNotResponding({ response: last })
  })

/** Supported PIDs across 0100/0120/0140/..., following the "next range supported" bit. */
export const readSupportedPids = (elm: Elm327, first: ReadonlyArray<string>): Effect.Effect<string[], Disconnected> =>
  Effect.gen(function*() {
    const all = [...first]
    let next = first.includes("20") ? 0x20 : undefined
    while (next !== undefined && next <= 0xc0) {
      const pid = next.toString(16).toUpperCase().padStart(2, "0")
      const bytes = yield* elm.mode01(pid, { timeoutMs: 3000 }).pipe(
        Effect.catch((e: CommandTimeout | Disconnected | CommandRejected) =>
          e._tag === "Disconnected" ? Effect.fail(e) : Effect.succeed(undefined)
        )
      )
      if (bytes === undefined) break
      const range = parseSupportedMask(next, bytes)
      all.push(...range)
      const following = next + 0x20
      next = range.includes(following.toString(16).toUpperCase().padStart(2, "0")) ? following : undefined
    }
    return all
  })

export const readVin = (elm: Elm327): Effect.Effect<string | undefined, Disconnected> =>
  elm.query("0902", { timeoutMs: 6000 }).pipe(
    Effect.map(parseVin),
    Effect.catch((e: CommandTimeout | Disconnected | CommandRejected) =>
      e._tag === "Disconnected" ? Effect.fail(e) : Effect.succeed(undefined)
    )
  )

export type { ObdError }
