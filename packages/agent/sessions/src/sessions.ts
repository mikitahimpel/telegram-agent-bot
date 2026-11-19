import { Clock, Config, Effect, Layer } from "effect"
import { DailyLimitReached, StorageError } from "@bot/core-contracts/errors"
import { ClaudeSessionId, SessionKey, ThreadId } from "@bot/core-contracts/ids"
import { Lang } from "@bot/core-contracts/lang"
import { Schema } from "effect"
import { Sessions, type SessionRecord, type UsageSummary } from "@bot/core-contracts/sessions"

export type SqlStorageLike = {
  readonly exec: (
    query: string,
    // oxlint-disable-next-line typescript/no-explicit-any
    ...bindings: Array<any>
  // oxlint-disable-next-line typescript/no-explicit-any
  ) => { readonly toArray: () => Array<any> }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    key TEXT PRIMARY KEY,
    thread_id INTEGER,
    title TEXT NOT NULL,
    claude_session_id TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    runs INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    at INTEGER NOT NULL,
    day TEXT NOT NULL,
    cost_usd REAL NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    is_error INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS runs_day ON runs (day)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
]

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const decodeLang = Schema.decodeUnknownOption(Lang)

const toRecord = (row: Record<string, unknown>): SessionRecord => ({
  key: SessionKey.make(String(row.key)),
  threadId: row.thread_id === null || row.thread_id === undefined ? undefined : ThreadId.make(Number(row.thread_id)),
  title: String(row.title),
  claudeSessionId:
    row.claude_session_id === null || row.claude_session_id === undefined
      ? undefined
      : ClaudeSessionId.make(String(row.claude_session_id)),
  createdAt: Number(row.created_at),
  lastUsedAt: Number(row.last_used_at),
  runs: Number(row.runs)
})

export const make = (sql: SqlStorageLike, dailyLimit: number): Sessions["Service"] => {
  const run = <A>(operation: string, f: () => A) =>
    Effect.try({ try: f, catch: (cause) => new StorageError({ operation, cause }) })
  const rows = (operation: string, query: string, ...bindings: Array<unknown>) =>
    run(operation, () => sql.exec(query, ...bindings).toArray() as Array<Record<string, unknown>>)

  const get = (key: SessionKey) =>
    rows("sessions.get", "SELECT * FROM sessions WHERE key = ?", key).pipe(
      Effect.map((r) => (r[0] === undefined ? undefined : toRecord(r[0])))
    )

  const ensure: Sessions["Service"]["ensure"] = (key, threadId, title) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const defaultTitle = title ?? (threadId === undefined ? "main" : `Topic ${threadId}`)
      yield* rows(
        "sessions.ensure",
        "INSERT OR IGNORE INTO sessions (key, thread_id, title, created_at, last_used_at, runs) VALUES (?, ?, ?, ?, ?, 0)",
        key,
        threadId ?? null,
        defaultTitle,
        now,
        now
      )
      const rec = yield* get(key)
      if (rec === undefined) return yield* new StorageError({ operation: "sessions.ensure" })
      return rec
    })

  const getSetting = (name: string) =>
    rows("settings.get", "SELECT value FROM settings WHERE key = ?", name).pipe(
      Effect.map((r) => (r[0] === undefined ? undefined : String(r[0].value)))
    )

  const countToday = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const r = yield* rows("runs.countToday", "SELECT COUNT(*) AS n FROM runs WHERE day = ?", utcDay(now))
    return Number(r[0]?.n ?? 0)
  })

  return {
    get,
    ensure,
    setClaudeSessionId: (key, id) =>
      rows("sessions.setClaudeSessionId", "UPDATE sessions SET claude_session_id = ? WHERE key = ?", id, key).pipe(
        Effect.asVoid
      ),
    reset: (key) =>
      rows("sessions.reset", "UPDATE sessions SET claude_session_id = NULL WHERE key = ?", key).pipe(Effect.asVoid),
    list: rows("sessions.list", "SELECT * FROM sessions ORDER BY last_used_at DESC").pipe(Effect.map((r) => r.map(toRecord))),
    checkDailyLimit: Effect.gen(function* () {
      const n = yield* countToday
      if (n >= dailyLimit) return yield* new DailyLimitReached({ limit: dailyLimit })
    }),
    recordRun: (usage) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* rows(
          "runs.record",
          "INSERT INTO runs (session_key, at, day, cost_usd, input_tokens, output_tokens, duration_ms, is_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          usage.sessionKey,
          now,
          utcDay(now),
          usage.costUsd,
          usage.inputTokens,
          usage.outputTokens,
          usage.durationMs,
          usage.isError ? 1 : 0
        )
        yield* rows(
          "sessions.touch",
          "UPDATE sessions SET runs = runs + 1, last_used_at = ? WHERE key = ?",
          now,
          usage.sessionKey
        )
      }),
    usage: Effect.gen(function* () {
      const runsToday = yield* countToday
      const r = yield* rows(
        "runs.usage",
        `SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(input_tokens), 0) AS inp,
                COALESCE(SUM(output_tokens), 0) AS outp, MAX(at) AS last FROM runs`
      )
      const row = r[0] ?? {}
      return {
        runsToday,
        dailyLimit,
        runsTotal: Number(row.n ?? 0),
        costUsdTotal: Number(row.cost ?? 0),
        inputTokensTotal: Number(row.inp ?? 0),
        outputTokensTotal: Number(row.outp ?? 0),
        lastRunAt: row.last === null || row.last === undefined ? undefined : Number(row.last)
      } satisfies UsageSummary
    }),
    getLang: getSetting("lang").pipe(
      Effect.map((v) => {
        if (v === undefined) return undefined
        const o = decodeLang(v)
        return o._tag === "Some" ? o.value : undefined
      })
    ),
    setLang: (lang) =>
      rows(
        "settings.setLang",
        "INSERT INTO settings (key, value) VALUES ('lang', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        lang
      ).pipe(Effect.asVoid)
  }
}

export const migrate = (sql: SqlStorageLike) =>
  Effect.try({
    try: () => {
      for (const stmt of SCHEMA) sql.exec(stmt)
    },
    catch: (cause) => new StorageError({ operation: "sessions.migrate", cause })
  })

export const layer = (sql: SqlStorageLike) =>
  Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const limit = yield* Config.Int("DAILY_RUN_LIMIT").pipe(Config.withDefault(50))
      yield* migrate(sql)
      return make(sql, limit)
    })
  )
