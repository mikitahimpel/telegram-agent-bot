import { Data, Effect } from "effect"
import { COLUMNS, type Sample } from "./sample.ts"

export class CsvParseError extends Data.TaggedError("CsvParseError")<{
  readonly line: number
  readonly message: string
}> {}

const HEADER = COLUMNS.map(([name]) => name).join(",")

const cell = (v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? "" : String(Math.round(v * 1e6) / 1e6)

export const encodeCsv = (samples: ReadonlyArray<Sample>): string => {
  const lines = [HEADER]
  for (const s of samples) lines.push(COLUMNS.map(([, key]) => cell(s[key])).join(","))
  return lines.join("\n") + "\n"
}

export const parseCsv = (text: string): Effect.Effect<ReadonlyArray<Sample>, CsvParseError> =>
  Effect.suspend(() => {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "")
    const header = lines[0]?.split(",").map((h) => h.trim())
    if (header === undefined || !header.includes("ts")) {
      return Effect.fail(new CsvParseError({ line: 1, message: "missing header with a `ts` column" }))
    }
    const index = COLUMNS.map(([name, key]) => [header.indexOf(name), key] as const).filter(([i]) => i >= 0)
    const out: Array<Sample> = []
    for (let n = 1; n < lines.length; n++) {
      const cells = (lines[n] as string).split(",")
      const row: Record<string, number> = {}
      for (const [i, key] of index) {
        const raw = cells[i]?.trim() ?? ""
        if (raw === "") continue
        const v = Number(raw)
        if (!Number.isFinite(v)) {
          return Effect.fail(new CsvParseError({ line: n + 1, message: `column ${String(key)}: not a number "${raw}"` }))
        }
        row[key] = v
      }
      if (row["ts"] === undefined) {
        return Effect.fail(new CsvParseError({ line: n + 1, message: "empty ts" }))
      }
      out.push(row as unknown as Sample)
    }
    return Effect.succeed(out)
  })
