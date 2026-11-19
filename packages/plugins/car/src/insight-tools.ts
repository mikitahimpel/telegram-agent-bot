import { Effect, Schema } from "effect"
import { CarBackend } from "@bot/car-store/backend"
import { SCHEMA_DESCRIPTION } from "@bot/car-store/schema"
import type { AgentTool } from "@bot/core-contracts/plugin"
import type { Lang } from "@bot/core-contracts/lang"

const SqlInput = Schema.Struct({
  query: Schema.String.annotate({ description: "One read-only SELECT or WITH statement over the car_* tables" })
})
const Empty = Schema.Struct({})

const langOf = (tgId: number) =>
  Effect.gen(function* () {
    const backend = yield* CarBackend
    const stored = yield* backend.getMeta(tgId, "lang")
    return (stored === "ru" ? "ru" : "en") as Lang
  })

export const insightTools: ReadonlyArray<AgentTool<CarBackend>> = [
  {
    name: "car_sql",
    description: `Run ONE read-only SQL query (SQLite dialect, SELECT or WITH only, max 1000 rows, no PRAGMA/ATTACH/writes) over the user's own car data. Prefer this for any number, trend or comparison: it is exact and fast. ${SCHEMA_DESCRIPTION}`,
    input: SqlInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const backend = yield* CarBackend
        const result = yield* backend.query(ctx.tgId, (raw as typeof SqlInput.Type).query)
        return result.ok
          ? { columns: result.columns, rows: result.rows, rowCount: result.rows.length, truncated: result.truncated }
          : { error: result.error }
      })
  },
  {
    name: "car_overview",
    description:
      "Server-computed overview of the car: totals, per-week and per-month stats (distance, time, L/100 km, idle share), battery status and trend, engine status with active fault codes explained, open alerts. Use it first for general questions about the car's condition.",
    input: Empty,
    handler: (_raw, ctx) =>
      Effect.gen(function* () {
        const backend = yield* CarBackend
        return yield* backend.overview(ctx.tgId, yield* langOf(ctx.tgId))
      })
  },
  {
    name: "car_dtc",
    description:
      "Current fault codes (check engine) from the latest scan with plain-language explanation, severity, whether it is safe to drive, causes and what to do, plus first/last seen times.",
    input: Empty,
    handler: (_raw, ctx) =>
      Effect.gen(function* () {
        const backend = yield* CarBackend
        return yield* backend.dtcCurrent(ctx.tgId, yield* langOf(ctx.tgId))
      })
  }
]
