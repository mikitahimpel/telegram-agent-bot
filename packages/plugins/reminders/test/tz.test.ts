import { describe, expect, it } from "vite-plus/test"
import { formatIsoLocal, isValidTimeZone, nextRecurrence, parseAt, toInstant, toLocal, tomorrowAt, type Recurrence } from "../src/tz.ts"

const local = (year: number, month: number, day: number, hour: number, minute = 0) => ({ year, month, day, hour, minute })
const iso = (ms: number) => new Date(ms).toISOString()

describe("timezone math", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Europe/Warsaw")).toBe(true)
    expect(isValidTimeZone("Mars/Base")).toBe(false)
    expect(isValidTimeZone("")).toBe(false)
  })

  it("converts local time to the instant across offsets", () => {
    expect(iso(toInstant(local(2026, 1, 15, 9), "Europe/Warsaw"))).toBe("2026-01-15T08:00:00.000Z")
    expect(iso(toInstant(local(2026, 7, 15, 9), "Europe/Warsaw"))).toBe("2026-07-15T07:00:00.000Z")
    expect(iso(toInstant(local(2026, 7, 15, 9), "Asia/Kolkata"))).toBe("2026-07-15T03:30:00.000Z")
  })

  it("moves nonexistent spring-forward times to the later wall clock", () => {
    expect(iso(toInstant(local(2026, 3, 8, 2, 30), "America/New_York"))).toBe("2026-03-08T07:30:00.000Z")
    expect(iso(toInstant(local(2026, 3, 29, 2, 30), "Europe/Warsaw"))).toBe("2026-03-29T01:30:00.000Z")
  })

  it("picks the first occurrence of ambiguous fall-back times", () => {
    expect(iso(toInstant(local(2026, 11, 1, 1, 30), "America/New_York"))).toBe("2026-11-01T05:30:00.000Z")
  })

  it("round trips through toLocal", () => {
    const ms = toInstant(local(2026, 10, 25, 9, 15), "Europe/Warsaw")
    expect(formatIsoLocal(toLocal(ms, "Europe/Warsaw"))).toBe("2026-10-25T09:15")
  })

  it("parses at values", () => {
    expect(parseAt("2026-11-20T09:00")).toEqual({ _tag: "Local", local: local(2026, 11, 20, 9) })
    expect(parseAt("2026-11-20 09:00:30")).toEqual({ _tag: "Local", local: local(2026, 11, 20, 9) })
    expect(parseAt("2026-11-20T09:00:00Z")).toEqual({ _tag: "Instant", ms: Date.UTC(2026, 10, 20, 9) })
    expect(parseAt("2026-02-30T09:00")).toBeUndefined()
    expect(parseAt("tomorrow")).toBeUndefined()
  })

  it("computes tomorrow at a fixed hour", () => {
    const now = Date.UTC(2026, 2, 7, 22, 0)
    expect(iso(tomorrowAt(now, "America/New_York", 9))).toBe("2026-03-08T13:00:00.000Z")
  })
})

describe("repeat rules", () => {
  const step = (r: Recurrence, tz: string, now = 0) => nextRecurrence(r, tz, now)

  it("does not repeat when none", () => {
    expect(step({ local: local(2026, 1, 1, 9), anchorDay: 1, repeat: "none" }, "UTC")).toBeUndefined()
  })

  it("keeps wall-clock time across DST for daily", () => {
    const tz = "Europe/Warsaw"
    const next = step({ local: local(2026, 3, 28, 9), anchorDay: 28, repeat: "daily" }, tz)!
    expect(next.local).toEqual(local(2026, 3, 29, 9))
    expect(iso(toInstant(next.local, tz))).toBe("2026-03-29T07:00:00.000Z")
  })

  it("skips weekends for weekdays", () => {
    const friday = local(2026, 11, 20, 8)
    expect(step({ local: friday, anchorDay: 20, repeat: "weekdays" }, "UTC")!.local).toEqual(local(2026, 11, 23, 8))
    expect(step({ local: local(2026, 11, 18, 8), anchorDay: 18, repeat: "weekdays" }, "UTC")!.local).toEqual(local(2026, 11, 19, 8))
  })

  it("adds seven days for weekly, crossing month end", () => {
    expect(step({ local: local(2026, 12, 28, 8), anchorDay: 28, repeat: "weekly" }, "UTC")!.local).toEqual(local(2027, 1, 4, 8))
  })

  it("clamps monthly to month length and returns to the anchor day", () => {
    const jan = { local: local(2026, 1, 31, 10), anchorDay: 31, repeat: "monthly" as const }
    const feb = step(jan, "UTC")!
    expect(feb.local).toEqual(local(2026, 2, 28, 10))
    const mar = step(feb, "UTC")!
    expect(mar.local).toEqual(local(2026, 3, 31, 10))
    expect(step({ local: local(2026, 12, 15, 10), anchorDay: 15, repeat: "monthly" }, "UTC")!.local).toEqual(local(2027, 1, 15, 10))
  })

  it("skips occurrences that are already in the past", () => {
    const now = Date.UTC(2026, 0, 10, 12)
    const next = step({ local: local(2026, 1, 1, 9), anchorDay: 1, repeat: "daily" }, "UTC", now)!
    expect(next.local).toEqual(local(2026, 1, 11, 9))
  })
})
