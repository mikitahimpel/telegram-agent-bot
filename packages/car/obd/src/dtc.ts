import { Effect } from "effect"
import type { DtcCode } from "@bot/car-format/insights"
import { type Elm327, findErrorToken } from "./elm327.ts"
import { groupMessages } from "./messages.ts"
import { type CommandTimeout, type Disconnected, EcuNotResponding } from "./errors.ts"

export type DtcKind = DtcCode["kind"]
export type DtcWireStyle = "can" | "legacy" | "auto"
export type DtcModeStatus = "read" | "no_data" | "failed"

export type DtcScan = {
  readonly milOn: boolean
  readonly reportedCount: number | undefined
  readonly codes: ReadonlyArray<DtcCode>
  readonly modes: {
    readonly status: DtcModeStatus
    readonly stored: DtcModeStatus
    readonly pending: DtcModeStatus
    readonly permanent: DtcModeStatus
  }
}

export const decodeDtc = (hi: number, lo: number): string => {
  const letter = "PCBU"[(hi >> 6) & 3] as string
  const digit = (hi >> 4) & 3
  return `${letter}${digit}${(hi & 0xf).toString(16).toUpperCase()}${lo.toString(16).toUpperCase().padStart(2, "0")}`
}

const pairs = (bytes: ReadonlyArray<number>): Array<string> => {
  const out: Array<string> = []
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const hi = bytes[i] as number
    const lo = bytes[i + 1] as number
    if (hi === 0 && lo === 0) continue
    out.push(decodeDtc(hi, lo))
  }
  return out
}

export const parseDtcResponse = (
  lines: ReadonlyArray<string>,
  sid: 0x43 | 0x47 | 0x4a,
  style: DtcWireStyle = "auto"
): ReadonlyArray<string> | undefined => {
  let found = false
  const codes: Array<string> = []
  for (const msg of groupMessages(lines)) {
    if (msg[0] !== sid) continue
    found = true
    const rest = msg.slice(1)
    if (style === "legacy") codes.push(...pairs(rest))
    else codes.push(...pairs(rest.slice(1, 1 + 2 * (rest[0] ?? 0))))
  }
  return found ? [...new Set(codes)] : undefined
}

export const parseMonitorStatus = (
  lines: ReadonlyArray<string>
): { readonly milOn: boolean; readonly count: number } | undefined => {
  let found = false
  let milOn = false
  let count = 0
  for (const msg of groupMessages(lines)) {
    if (msg[0] !== 0x41 || msg[1] !== 0x01 || msg[2] === undefined) continue
    found = true
    if ((msg[2] & 0x80) !== 0) milOn = true
    count += msg[2] & 0x7f
  }
  return found ? { milOn, count } : undefined
}

const SIDS = { stored: [0x43, "03"], pending: [0x47, "07"], permanent: [0x4a, "0A"] } as const

const statusOf = (lines: ReadonlyArray<string>, parsed: unknown): DtcModeStatus =>
  parsed !== undefined ? "read" : findErrorToken(lines) === "NODATA" ? "no_data" : "failed"

const sendOrFail = (elm: Elm327, command: string, timeoutMs: number): Effect.Effect<ReadonlyArray<string> | undefined, Disconnected> =>
  elm.send(command, { timeoutMs }).pipe(
    Effect.catch((e: CommandTimeout | Disconnected) => (e._tag === "Disconnected" ? Effect.fail(e) : Effect.succeed(undefined)))
  )

export const readDtcScan = (
  elm: Elm327,
  style: DtcWireStyle = "auto"
): Effect.Effect<DtcScan, EcuNotResponding | Disconnected> =>
  Effect.gen(function*() {
    const statusLines = yield* sendOrFail(elm, "0101", 4000)
    const status = statusLines === undefined ? undefined : parseMonitorStatus(statusLines)
    const codes: Array<DtcCode> = []
    const modeStatus: Record<DtcKind, DtcModeStatus> = { stored: "failed", pending: "failed", permanent: "failed" }
    for (const kind of ["stored", "pending", "permanent"] as const) {
      const [sid, command] = SIDS[kind]
      const lines = yield* sendOrFail(elm, command, 6000)
      if (lines === undefined) continue
      const parsed = parseDtcResponse(lines, sid, style)
      modeStatus[kind] = statusOf(lines, parsed)
      for (const code of parsed ?? []) codes.push({ code, kind })
    }
    const statusMode: DtcModeStatus =
      statusLines === undefined ? "failed" : status !== undefined ? "read" : statusOf(statusLines, undefined)
    if (statusMode !== "read" && modeStatus.stored !== "read") {
      return yield* new EcuNotResponding({ response: statusMode === "no_data" ? "NO DATA" : "UNREADABLE" })
    }
    return {
      milOn: status?.milOn ?? false,
      reportedCount: status?.count,
      codes,
      modes: { status: statusMode, ...modeStatus }
    } satisfies DtcScan
  })

export type DtcReportContext = {
  readonly readAt: number
  readonly tripId: string | null
  readonly vin: string | null
}

export const scanToReport = (scan: DtcScan, ctx: DtcReportContext) => ({
  readAt: ctx.readAt,
  milOn: scan.milOn,
  codes: scan.codes,
  tripId: ctx.tripId,
  vin: ctx.vin
})
