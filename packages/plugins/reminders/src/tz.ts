export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly"

export const REPEATS: ReadonlyArray<Repeat> = ["none", "daily", "weekdays", "weekly", "monthly"]

export type LocalDateTime = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
}

export type Recurrence = {
  readonly local: LocalDateTime
  readonly anchorDay: number
  readonly repeat: Repeat
}

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (tz: string): Intl.DateTimeFormat => {
  let f = formatters.get(tz)
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    })
    formatters.set(tz, f)
  }
  return f
}

export const isValidTimeZone = (tz: string): boolean => {
  if (tz.trim() === "") return false
  try {
    formatterFor(tz)
    return true
  } catch {
    return false
  }
}

type Fields = LocalDateTime & { readonly second: number }

const fieldsAt = (ms: number, tz: string): Fields => {
  const out: Record<string, number> = {}
  for (const part of formatterFor(tz).formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value)
  }
  return {
    year: out["year"] ?? 1970,
    month: out["month"] ?? 1,
    day: out["day"] ?? 1,
    hour: (out["hour"] ?? 0) % 24,
    minute: out["minute"] ?? 0,
    second: out["second"] ?? 0
  }
}

const asUtc = (f: Fields): number => Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second)

const offsetAt = (ms: number, tz: string): number => asUtc(fieldsAt(ms, tz)) - Math.floor(ms / 1000) * 1000

export const toLocal = (ms: number, tz: string): LocalDateTime => {
  const { second: _second, ...local } = fieldsAt(ms, tz)
  return local
}

export const weekdayOf = (local: LocalDateTime): number => new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()

const sameLocal = (a: LocalDateTime, b: LocalDateTime): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute

const HOUR = 3_600_000
const DAY = 24 * HOUR

export const toInstant = (local: LocalDateTime, tz: string): number => {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  const before = offsetAt(guess - DAY, tz)
  const after = offsetAt(guess + DAY, tz)
  const candidates = [...new Set([guess - before, guess - after])]
    .filter((t) => sameLocal(toLocal(t, tz), local))
    .sort((a, b) => a - b)
  return candidates[0] ?? guess - Math.min(before, after)
}

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

const addDays = (local: LocalDateTime, days: number): LocalDateTime => {
  const d = new Date(Date.UTC(local.year, local.month - 1, local.day + days))
  return { ...local, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

const addMonth = (local: LocalDateTime, anchorDay: number): LocalDateTime => {
  const total = local.year * 12 + (local.month - 1) + 1
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return { ...local, year, month, day: Math.min(anchorDay, daysInMonth(year, month)) }
}

export const advance = (r: Recurrence): LocalDateTime | undefined => {
  switch (r.repeat) {
    case "none":
      return undefined
    case "daily":
      return addDays(r.local, 1)
    case "weekly":
      return addDays(r.local, 7)
    case "weekdays": {
      let next = addDays(r.local, 1)
      while (weekdayOf(next) === 0 || weekdayOf(next) === 6) next = addDays(next, 1)
      return next
    }
    case "monthly":
      return addMonth(r.local, r.anchorDay)
  }
}

export const nextRecurrence = (r: Recurrence, tz: string, now: number): Recurrence | undefined => {
  let current = r
  for (let i = 0; i < 10_000; i++) {
    const local = advance(current)
    if (local === undefined) return undefined
    current = { ...current, local }
    if (toInstant(local, tz) > now) return current
  }
  return undefined
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
const ABSOLUTE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i

export type ParsedAt =
  | { readonly _tag: "Local"; readonly local: LocalDateTime }
  | { readonly _tag: "Instant"; readonly ms: number }

export const parseAt = (text: string): ParsedAt | undefined => {
  const trimmed = text.trim()
  const m = LOCAL_PATTERN.exec(trimmed)
  if (m !== null) {
    const local: LocalDateTime = {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5])
    }
    const valid =
      local.month >= 1 &&
      local.month <= 12 &&
      local.day >= 1 &&
      local.day <= daysInMonth(local.year, local.month) &&
      local.hour <= 23 &&
      local.minute <= 59
    return valid ? { _tag: "Local", local } : undefined
  }
  if (ABSOLUTE_PATTERN.test(trimmed)) {
    const ms = Date.parse(trimmed)
    return Number.isNaN(ms) ? undefined : { _tag: "Instant", ms }
  }
  return undefined
}

const pad = (n: number) => String(n).padStart(2, "0")

export const formatIsoLocal = (local: LocalDateTime): string =>
  `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`

export const formatHuman = (ms: number, tz: string, lang: "ru" | "en"): string =>
  new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(ms))

export const tomorrowAt = (now: number, tz: string, hour: number): number => {
  const local = addDays({ ...toLocal(now, tz), hour, minute: 0 }, 1)
  return toInstant(local, tz)
}
