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
  | "dtc_mil_on"
  | "dtc_pending_only"
  | "dtc_multi_ecu"
  | "dtc_none"
  | "dtc_no_data"
  | "dtc_legacy_kwp"
  | "cranking"

export type SimEcu = {
  readonly stored: ReadonlyArray<string>
  readonly pending: ReadonlyArray<string>
  readonly permanent: ReadonlyArray<string>
  readonly mil: boolean
}

export type SimCar = {
  ignition: boolean
  rpm: number
  voltageV: number
  ecus: ReadonlyArray<SimEcu>
  wire: "can" | "kwp"
  dtcNoData: boolean
}

export const makeSimCar = (patch: Partial<SimCar> = {}): SimCar => ({
  ignition: true,
  rpm: 2000,
  voltageV: 14.1,
  ecus: [{ stored: [], pending: [], permanent: [], mil: false }],
  wire: "can",
  dtcNoData: false,
  ...patch
})

export type SimulatorOptions = {
  readonly unsupported?: ReadonlyArray<string>
  readonly dropAfterMs?: number
  readonly car?: SimCar
}

const none: SimEcu = { stored: [], pending: [], permanent: [], mil: false }

const scenarioCar = (scenario: SimulatorScenario): SimCar => {
  switch (scenario) {
    case "dtc_mil_on":
      return makeSimCar({ ecus: [{ stored: ["P0301", "P0420"], pending: ["P0171"], permanent: ["P0420"], mil: true }] })
    case "dtc_pending_only":
      return makeSimCar({ ecus: [{ ...none, pending: ["P0171"] }] })
    case "dtc_multi_ecu":
      return makeSimCar({
        ecus: [
          { stored: ["P0301", "P0302", "P0303", "P0304"], pending: [], permanent: [], mil: true },
          { stored: ["C0035"], pending: ["U0100"], permanent: [], mil: false }
        ]
      })
    case "dtc_legacy_kwp":
      return makeSimCar({
        wire: "kwp",
        ecus: [{ stored: ["P0133", "P0301", "P0420", "B1234"], pending: [], permanent: [], mil: true }]
      })
    case "dtc_no_data":
      return makeSimCar({ dtcNoData: true })
    case "cranking":
      return makeSimCar({ rpm: 0, voltageV: 12.6 })
    default:
      return makeSimCar()
  }
}

export const crankingScript = (
  car: SimCar,
  options: { readonly idleMs?: number; readonly crankMs?: number; readonly minV?: number } = {}
) =>
  Effect.gen(function* () {
    const minV = options.minV ?? 9.7
    car.ignition = true
    car.rpm = 0
    car.voltageV = 12.6
    yield* Effect.sleep(`${options.idleMs ?? 4000} millis`)
    const crankMs = options.crankMs ?? 1500
    const steps = 6
    for (let i = 0; i < steps; i++) {
      car.voltageV = i % 2 === 0 ? minV : minV + 1.2
      car.rpm = 200 + i * 10
      yield* Effect.sleep(`${crankMs / steps} millis`)
    }
    car.rpm = 900
    car.voltageV = 14.2
  })

const encodeDtc = (code: string): ReadonlyArray<number> => {
  const letter = "PCBU".indexOf(code[0] as string)
  const digit = parseInt(code[1] as string, 10)
  return [(letter << 6) | (digit << 4) | parseInt(code[2] as string, 16), parseInt(code.slice(3), 16)]
}

const dtcLines = (
  sid: number,
  codes: ReadonlyArray<string>,
  wire: "can" | "kwp",
  spaces: boolean
): ReadonlyArray<string> => {
  const body = codes.flatMap(encodeDtc)
  if (wire === "kwp") {
    const lines: Array<string> = []
    for (let i = 0; i === 0 || i < body.length; i += 6) {
      const row = body.slice(i, i + 6)
      while (row.length < 6) row.push(0)
      lines.push(hex([sid, ...row], spaces))
    }
    return lines
  }
  const payload = [sid, codes.length, ...body]
  if (payload.length <= 7) {
    while (payload.length < 7) payload.push(0)
    return [hex(payload, spaces)]
  }
  const sep = spaces ? " " : ""
  const lines = [
    payload.length.toString(16).toUpperCase().padStart(3, "0"),
    `0:${sep}${hex(payload.slice(0, 6), spaces)}`
  ]
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) {
    const part = payload.slice(i, i + 7)
    while (part.length < 7) part.push(0)
    lines.push(`${(n % 16).toString(16).toUpperCase()}:${sep}${hex(part, spaces)}`)
  }
  return lines
}

const ALL_PIDS = ["01", "04", "05", "0B", "0C", "0D", "0F", "10", "11", "2F", "42", "5E"]

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
  const simCar = options.car ?? scenarioCar(scenario)

  const open = (): Effect.Effect<ObdTransport, never, Scope.Scope> =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const queue = yield* Queue.unbounded<string, Disconnected | Cause.Done>()
      const link = { echo: true, spaces: true, alive: true }

      const emit = (text: string) =>
        Effect.gen(function* () {
          for (let i = 0; i < text.length; i += 18) yield* Queue.offer(queue, text.slice(i, i + 18))
        })

      const reply = (cmd: string, lines: ReadonlyArray<string>) =>
        emit((link.echo ? cmd + "\r" : "") + lines.join("\r") + "\r\r>")

      const respond = (raw: string) =>
        Effect.gen(function* () {
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
            if (cmd === "ATDPN") return yield* reply(cmd, [simCar.wire === "kwp" ? "A5" : "A6"])
            if (cmd === "ATRV") return yield* reply(cmd, [`${simCar.voltageV.toFixed(1)}V`])
            return yield* reply(cmd, ["OK"])
          }
          const m = /^01([0-9A-F]{2})$/.exec(cmd)
          if (m !== null) {
            const pid = m[1] as string
            yield* Effect.sleep(`${pidLatencyMs} millis`)
            if (scenario === "ignition_off" || !simCar.ignition) {
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
            if (pid === "01") {
              if (simCar.dtcNoData) return yield* reply(cmd, ["NO DATA"])
              return yield* reply(
                cmd,
                simCar.ecus.map((e) =>
                  hex([0x41, 0x01, (e.mil ? 0x80 : 0) | (e.stored.length & 0x7f), 0x07, 0xe5, 0x00], link.spaces)
                )
              )
            }
            const data =
              pid === "0C"
                ? [Math.floor((simCar.rpm * 4) / 256), (simCar.rpm * 4) % 256]
                : pid === "42"
                  ? [Math.floor((simCar.voltageV * 1000) / 256), Math.round(simCar.voltageV * 1000) % 256]
                  : SIM_DATA[pid]
            if (!supported.has(n) || data === undefined) return yield* reply(cmd, ["NO DATA"])
            return yield* reply(cmd, [hex([0x41, n, ...data], link.spaces)])
          }
          if (cmd === "0902") {
            yield* Effect.sleep(`${pidLatencyMs * 3} millis`)
            if (scenario === "ignition_off" || !simCar.ignition) return yield* reply(cmd, ["NO DATA"])
            const bytes = [0x49, 0x02, 0x01, ...[...SIM_VIN].map((c) => c.charCodeAt(0))]
            const sep = link.spaces ? " " : ""
            return yield* reply(cmd, [
              "014",
              `0:${sep}${hex(bytes.slice(0, 6), link.spaces)}`,
              `1:${sep}${hex(bytes.slice(6, 13), link.spaces)}`,
              `2:${sep}${hex(bytes.slice(13, 20), link.spaces)}`
            ])
          }
          const dtcMode = /^(03|07|0A)$/.exec(cmd)
          if (dtcMode !== null) {
            yield* Effect.sleep(`${pidLatencyMs * 2} millis`)
            if (scenario === "ignition_off" || !simCar.ignition || simCar.dtcNoData)
              return yield* reply(cmd, ["NO DATA"])
            const kind = cmd === "03" ? "stored" : cmd === "07" ? "pending" : "permanent"
            const sid = cmd === "03" ? 0x43 : cmd === "07" ? 0x47 : 0x4a
            return yield* reply(
              cmd,
              simCar.ecus.flatMap((e) => dtcLines(sid, e[kind], simCar.wire, link.spaces))
            )
          }
          return yield* reply(cmd, ["?"])
        })

      if (scenario === "cranking" && options.car === undefined) yield* Effect.forkIn(crankingScript(simCar), scope)

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
          link.alive ? Effect.forkIn(respond(line), scope).pipe(Effect.asVoid) : Effect.fail(new Disconnected()),
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
