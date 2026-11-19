import { Effect, Queue, Scope, Stream } from "effect"
import type { Cause } from "effect"
import { Disconnected } from "./errors.ts"
import type { ObdTransport } from "./transport.ts"

export type SimulatorScenario =
  | "normal"
  | "ignition_off"
  | "clone_garbage"
  | "drops_every_60s"
  | "slow_ecu"
  | "no_fuel_pid"
  | "late_reply"

export interface SimulatorOptions {
  readonly unsupported?: ReadonlyArray<string>
  readonly dropAfterMs?: number
}

const ALL_PIDS = ["04", "05", "0B", "0C", "0D", "0F", "10", "11", "2F", "42", "5E"]

export const SIM_DATA: Readonly<Record<string, ReadonlyArray<number>>> = {
  "04": [0x80],
  "05": [0x82],
  "0B": [100],
  "0C": [0x1f, 0x40],
  "0D": [60],
  "0F": [0x41],
  "10": [0x04, 0xd2],
  "11": [0x33],
  "2F": [0x80],
  "42": [0x37, 0x14],
  "5E": [0x00, 0x64]
}

export const SIM_VIN = "WP0ZZZ99ZTS392124"

const hex = (bytes: ReadonlyArray<number>, spaces: boolean): string =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(spaces ? " " : "")

const maskBytes = (base: number, supported: ReadonlySet<number>): number[] => {
  const out = [0, 0, 0, 0]
  for (let i = 0; i < 32; i++) {
    const pid = base + i + 1
    const has = supported.has(pid) || (i === 31 && [...supported].some((p) => p > pid))
    if (has) out[i >> 3] = (out[i >> 3] as number) | (0x80 >> (i & 7))
  }
  return out
}

const GARBAGE = "ÿ\u0000þ?\u0001ó"

export const simulatorTransport = (
  scenario: SimulatorScenario,
  options: SimulatorOptions = {}
): Effect.Effect<ObdTransport, never, Scope.Scope> => {
  const unsupported = new Set([...(options.unsupported ?? []), ...(scenario === "no_fuel_pid" ? ["5E"] : [])])
  const supported = new Set(ALL_PIDS.filter((p) => !unsupported.has(p)).map((p) => parseInt(p, 16)))
  const pidLatencyMs = scenario === "slow_ecu" ? 400 : 20
  const car = { garbageLeft: scenario === "clone_garbage" ? 2 : 0, lateLeft: scenario === "late_reply" ? 1 : 0 }

  const open = (): Effect.Effect<ObdTransport, never, Scope.Scope> =>
    Effect.gen(function*() {
      const scope = yield* Effect.scope
      const queue = yield* Queue.unbounded<string, Disconnected | Cause.Done>()
      const link = { echo: true, spaces: true, alive: true }

      const emit = (text: string) =>
        Effect.gen(function*() {
          for (let i = 0; i < text.length; i += 18) yield* Queue.offer(queue, text.slice(i, i + 18))
        })

      const reply = (cmd: string, lines: ReadonlyArray<string>) =>
        emit((link.echo ? cmd + "\r" : "") + lines.join("\r") + "\r\r>")

      const respond = (raw: string) =>
        Effect.gen(function*() {
          const cmd = raw.replace(/\s/g, "").toUpperCase()
          if (cmd === "") return yield* emit(">")
          if (car.garbageLeft > 0) {
            car.garbageLeft--
            yield* Effect.sleep("100 millis")
            return yield* emit(GARBAGE + "\r>")
          }
          if (cmd === "ATZ") {
            link.echo = true
            link.spaces = true
            yield* Effect.sleep("300 millis")
            return yield* reply(cmd, ["", "ELM327 v1.5"])
          }
          if (cmd.startsWith("AT")) {
            yield* Effect.sleep("10 millis")
            if (cmd === "ATE0") link.echo = false
            if (cmd === "ATE1") link.echo = true
            if (cmd === "ATS0") link.spaces = false
            if (cmd === "ATS1") link.spaces = true
            if (cmd === "ATI" || cmd === "ATWS") return yield* reply(cmd, ["ELM327 v1.5"])
            if (cmd === "ATDPN") return yield* reply(cmd, ["A6"])
            if (cmd === "ATRV") return yield* reply(cmd, ["14.1V"])
            return yield* reply(cmd, ["OK"])
          }
          const m = /^01([0-9A-F]{2})$/.exec(cmd)
          if (m !== null) {
            const pid = m[1] as string
            yield* Effect.sleep(`${pidLatencyMs} millis`)
            if (scenario === "ignition_off") {
              return yield* reply(cmd, pid === "00" ? ["SEARCHING...", "UNABLE TO CONNECT"] : ["NO DATA"])
            }
            const n = parseInt(pid, 16)
            if (car.lateLeft > 0 && n % 0x20 !== 0) {
              car.lateLeft--
              yield* Effect.sleep("2500 millis")
            }
            if (n % 0x20 === 0) {
              const prefix = pid === "00" ? ["SEARCHING..."] : []
              return yield* reply(cmd, [...prefix, hex([0x41, n, ...maskBytes(n, supported)], link.spaces)])
            }
            const data = SIM_DATA[pid]
            if (!supported.has(n) || data === undefined) return yield* reply(cmd, ["NO DATA"])
            return yield* reply(cmd, [hex([0x41, n, ...data], link.spaces)])
          }
          if (cmd === "0902") {
            yield* Effect.sleep(`${pidLatencyMs * 3} millis`)
            if (scenario === "ignition_off") return yield* reply(cmd, ["NO DATA"])
            const bytes = [0x49, 0x02, 0x01, ...[...SIM_VIN].map((c) => c.charCodeAt(0))]
            const sep = link.spaces ? " " : ""
            return yield* reply(cmd, [
              "014",
              `0:${sep}${hex(bytes.slice(0, 6), link.spaces)}`,
              `1:${sep}${hex(bytes.slice(6, 13), link.spaces)}`,
              `2:${sep}${hex(bytes.slice(13, 20), link.spaces)}`
            ])
          }
          return yield* reply(cmd, ["?"])
        })

      if (scenario === "drops_every_60s") {
        const after = options.dropAfterMs ?? 60_000
        yield* Effect.forkIn(
          Effect.sleep(after).pipe(
            Effect.andThen(
              Effect.sync(() => {
                link.alive = false
              })
            ),
            Effect.andThen(Queue.fail(queue, new Disconnected()))
          ),
          scope
        )
      }

      const transport: ObdTransport = {
        kind: "simulator",
        name: "Simulated ELM327",
        write: (line) =>
          link.alive
            ? Effect.forkIn(respond(line), scope).pipe(Effect.asVoid)
            : Effect.fail(new Disconnected()),
        incoming: Stream.fromQueue(queue),
        close: Effect.sync(() => {
          link.alive = false
        }),
        reopen: Effect.suspend(open)
      }
      yield* Effect.addFinalizer(() => transport.close)
      return transport
    })

  return open()
}
