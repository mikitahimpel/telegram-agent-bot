import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { ConfigProvider, Effect, Exit } from "effect"
import { Sessions } from "@bot/core-contracts/sessions"
import { ClaudeSessionId, SessionKey, ThreadId } from "@bot/core-contracts/ids"
import { layer, migrate, type SqlStorageLike } from "../src/sessions.ts"

const fakeSql = (): SqlStorageLike => {
  const db = new DatabaseSync(":memory:")
  return {
    exec: (query, ...bindings) => {
      const stmt = db.prepare(query)
      const isRead = /^\s*select/i.test(query)
      const rows = isRead ? (stmt.all(...bindings) as Array<unknown>) : (stmt.run(...bindings), [])
      return { toArray: () => rows }
    }
  }
}

const provide = <A, E>(sql: SqlStorageLike, limit: number | undefined, eff: Effect.Effect<A, E, Sessions>) =>
  eff.pipe(
    Effect.provide(layer(sql)),
    Effect.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown(limit === undefined ? {} : { DAILY_RUN_LIMIT: String(limit) }))
    )
  )

const usage = (key: SessionKey) => ({
  sessionKey: key,
  costUsd: 0.5,
  inputTokens: 10,
  outputTokens: 20,
  durationMs: 100,
  isError: false
})

describe("Sessions over SQL", () => {
  it("ensures, stores claude id, resets, lists", async () => {
    const main = SessionKey.make("main")
    const topic = SessionKey.make("t5")
    const out = await Effect.runPromise(
      provide(
        fakeSql(),
        undefined,
        Effect.gen(function* () {
          const s = yield* Sessions
          const a = yield* s.ensure(main, undefined)
          const b = yield* s.ensure(topic, ThreadId.make(5), "Cars")
          yield* s.ensure(topic, ThreadId.make(5), "ignored")
          yield* s.setClaudeSessionId(main, ClaudeSessionId.make("abc"))
          const withId = yield* s.get(main)
          yield* s.reset(main)
          const after = yield* s.get(main)
          return { a, b, withId, after, list: yield* s.list, missing: yield* s.get(SessionKey.make("zz")) }
        })
      )
    )
    expect(out.a.title).toBe("main")
    expect(out.b.title).toBe("Cars")
    expect(out.withId?.claudeSessionId).toBe("abc")
    expect(out.after?.claudeSessionId).toBeUndefined()
    expect(out.list).toHaveLength(2)
    expect(out.missing).toBeUndefined()
  })

  it("enforces the daily limit and aggregates usage", async () => {
    const key = SessionKey.make("main")
    const exit = await Effect.runPromiseExit(
      provide(
        fakeSql(),
        2,
        Effect.gen(function* () {
          const s = yield* Sessions
          yield* s.ensure(key, undefined)
          yield* s.checkDailyLimit
          yield* s.recordRun(usage(key))
          yield* s.recordRun({ ...usage(key), isError: true })
          const u = yield* s.usage
          expect(u.runsToday).toBe(2)
          expect(u.runsTotal).toBe(2)
          expect(u.costUsdTotal).toBeCloseTo(1)
          expect(u.inputTokensTotal).toBe(20)
          expect((yield* s.get(key))?.runs).toBe(2)
          yield* s.checkDailyLimit
        })
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("DailyLimitReached")
  })

  it("defaults the limit to 50, stores lang, schema is idempotent", async () => {
    const sql = fakeSql()
    await Effect.runPromise(migrate(sql))
    const out = await Effect.runPromise(
      provide(
        sql,
        undefined,
        Effect.gen(function* () {
          const s = yield* Sessions
          const before = yield* s.getLang
          yield* s.setLang("ru")
          yield* s.setLang("en")
          return { before, after: yield* s.getLang, usage: yield* s.usage }
        })
      )
    )
    expect(out.before).toBeUndefined()
    expect(out.after).toBe("en")
    expect(out.usage.dailyLimit).toBe(50)
    expect(out.usage.lastRunAt).toBeUndefined()
  })
})
