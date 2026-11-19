import { parseCommand } from "@bot/telegram-schema/command"
import type { Message } from "@bot/telegram-schema/schema"

export const MAX_USES = 100
export const DEFAULT_USES = 1
export const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_NOTE_LENGTH = 100

export interface InviteOptions {
  readonly uses: number
  readonly ttlMs: number
  readonly plugins: ReadonlyArray<string>
  readonly note: string | undefined
}

export type InviteOptionsError =
  | { readonly kind: "uses"; readonly value: string }
  | { readonly kind: "ttl"; readonly value: string }
  | { readonly kind: "plugin"; readonly value: string }

export type ParsedInviteOptions =
  | { readonly ok: true; readonly options: InviteOptions }
  | { readonly ok: false; readonly error: InviteOptionsError }

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const

export const parseTtl = (raw: string): number | undefined => {
  const m = /^(\d{1,4})([mhd])$/i.exec(raw)
  if (m === null) return undefined
  const ms = Number(m[1]) * UNIT_MS[m[2]!.toLowerCase() as keyof typeof UNIT_MS]
  return ms > 0 && ms <= MAX_TTL_MS ? ms : undefined
}

const OPENERS: Record<string, string> = { '"': '"', "«": "»", "“": "”", "'": "'" }

export const parseInviteArgs = (args: string, knownPlugins: ReadonlyArray<string>): ParsedInviteOptions => {
  let uses = DEFAULT_USES
  let ttlMs = DEFAULT_TTL_MS
  let plugins: Array<string> = []
  const noteParts: Array<string> = []
  let rest = args.trim()

  while (rest !== "") {
    const opt = /^(uses|ttl|plugins)=(\S*)/i.exec(rest)
    if (opt !== null) {
      const key = opt[1]!.toLowerCase()
      const value = opt[2]!
      if (key === "uses") {
        const n = /^\d{1,4}$/.test(value) ? Number(value) : 0
        if (n < 1 || n > MAX_USES) return { ok: false, error: { kind: "uses", value } }
        uses = n
      } else if (key === "ttl") {
        const parsed = parseTtl(value)
        if (parsed === undefined) return { ok: false, error: { kind: "ttl", value } }
        ttlMs = parsed
      } else {
        const ids = value.split(",").map((x) => x.trim().toLowerCase()).filter((x) => x !== "")
        const unknown = ids.find((id) => !knownPlugins.includes(id))
        if (unknown !== undefined) return { ok: false, error: { kind: "plugin", value: unknown } }
        plugins = [...new Set(ids)]
      }
      rest = rest.slice(opt[0].length).trimStart()
      continue
    }
    const closer = OPENERS[rest[0]!]
    if (closer !== undefined) {
      const end = rest.indexOf(closer, 1)
      if (end !== -1) {
        noteParts.push(rest.slice(1, end))
        rest = rest.slice(end + 1).trimStart()
        continue
      }
    }
    noteParts.push(rest)
    rest = ""
  }

  const note = noteParts.join(" ").trim().slice(0, MAX_NOTE_LENGTH)
  return { ok: true, options: { uses, ttlMs, plugins, note: note === "" ? undefined : note } }
}

const START_CODE = /^inv_([A-Za-z0-9]{16,48})$/

export const inviteCodeFromMessage = (message: Message): string | undefined => {
  if (message.chat.type !== "private" || message.from === undefined || message.from.is_bot) return undefined
  const parsed = parseCommand(message)
  if (parsed === undefined || parsed.name !== "start") return undefined
  return START_CODE.exec(parsed.args)?.[1]
}
