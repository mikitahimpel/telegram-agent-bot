import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"
import type { JobHandler } from "@bot/core-contracts/scheduler"
import { makeStore, MAX_RETRIES, RETRY_BACKOFF_MS, type AlarmLike } from "../src/scheduler.ts"

const setup = () => {
  const db = new DatabaseSync(":memory:")
  const sql = { exec: (q: string, ...b: Array<any>) => ({ toArray: () => db.prepare(q).all(...b) as Array<any> }) }
  const alarms: Array<number | null> = []
  const alarm: AlarmLike = {
    setAlarm: async (at) => void alarms.push(at),
    deleteAlarm: async () => void alarms.push(null)
  }
  return { store: makeStore(sql, alarm), alarms }
}

const tg = TgId.make(7)

describe("scheduler", () => {
  it.effect("arms the alarm to the earliest job and clears it", () =>
    Effect.gen(function* () {
      const { store, alarms } = setup()
      yield* store.service.schedule({ id: "a", kind: "k", at: 5000, payload: "" })
      yield* store.service.schedule({ id: "b", kind: "k", at: 3000, payload: "" })
      yield* store.service.schedule({ id: "c", kind: "k", at: 9000, payload: "" })
      expect(alarms).toEqual([5000, 3000, 3000])
      yield* store.service.cancel("b")
      expect(alarms.at(-1)).toBe(5000)
      yield* store.service.cancel("a")
      yield* store.service.cancel("c")
      expect(alarms.at(-1)).toBeNull()
    })
  )

  it.effect("upserts, gets and lists by kind", () =>
    Effect.gen(function* () {
      const { store } = setup()
      yield* store.service.schedule({ id: "a", kind: "k", at: 2, payload: "x" })
      yield* store.service.schedule({ id: "a", kind: "k", at: 1, payload: "y" })
      yield* store.service.schedule({ id: "b", kind: "other", at: 1, payload: "" })
      expect(yield* store.service.get("a")).toEqual({ id: "a", kind: "k", at: 1, payload: "y" })
      expect(yield* store.service.get("zzz")).toBeUndefined()
      expect((yield* store.service.list("k")).map((j) => j.id)).toEqual(["a"])
    })
  )

  it.effect("runs only due jobs by kind, deletes them and re-arms", () =>
    Effect.gen(function* () {
      const { store, alarms } = setup()
      const seen: Array<string> = []
      const handlers: ReadonlyArray<JobHandler> = [
        { kind: "k", run: (job, ctx) => Effect.sync(() => void seen.push(`${job.id}:${ctx.tgId}`)) }
      ]
      yield* store.service.schedule({ id: "due", kind: "k", at: 100, payload: "" })
      yield* store.service.schedule({ id: "later", kind: "k", at: 10_000, payload: "" })
      yield* TestClock.setTime(500)
      yield* store.runDue(handlers, tg)
      expect(seen).toEqual(["due:7"])
      expect(yield* store.service.get("due")).toBeUndefined()
      expect(alarms.at(-1)).toBe(10_000)
    })
  )

  it.effect("drops unknown kinds", () =>
    Effect.gen(function* () {
      const { store } = setup()
      yield* store.service.schedule({ id: "u", kind: "nope", at: 1, payload: "" })
      yield* TestClock.setTime(10)
      yield* store.runDue<never>([], tg)
      expect(yield* store.service.get("u")).toBeUndefined()
    })
  )

  it.effect("lets a handler reschedule its own job", () =>
    Effect.gen(function* () {
      const { store } = setup()
      const handlers: ReadonlyArray<JobHandler> = [
        { kind: "k", run: (job) => store.service.schedule({ ...job, at: job.at + 1000 }) }
      ]
      yield* store.service.schedule({ id: "r", kind: "k", at: 100, payload: "" })
      yield* TestClock.setTime(200)
      yield* store.runDue(handlers, tg)
      expect((yield* store.service.get("r"))?.at).toBe(1100)
    })
  )

  it.effect("retries with backoff, isolates failures and drops after the limit", () =>
    Effect.gen(function* () {
      const { store, alarms } = setup()
      const ran: Array<string> = []
      const handlers: ReadonlyArray<JobHandler> = [
        {
          kind: "bad",
          run: (job) =>
            Effect.sync(() => void ran.push(job.id)).pipe(
              Effect.andThen(Effect.fail(new StorageError({ operation: "boom" })))
            )
        },
        { kind: "good", run: (job) => Effect.sync(() => void ran.push(job.id)) }
      ]
      yield* store.service.schedule({ id: "b", kind: "bad", at: 0, payload: "" })
      yield* store.service.schedule({ id: "g", kind: "good", at: 1, payload: "" })
      let now = 10
      yield* TestClock.setTime(now)
      yield* store.runDue(handlers, tg)
      expect(ran).toEqual(["b", "g"])
      expect(yield* store.service.get("g")).toBeUndefined()
      expect((yield* store.service.get("b"))?.at).toBe(now + RETRY_BACKOFF_MS[0]!)
      expect(alarms.at(-1)).toBe(now + RETRY_BACKOFF_MS[0]!)
      for (let i = 1; i < MAX_RETRIES; i++) {
        now += 1_000_000
        yield* TestClock.setTime(now)
        yield* store.runDue(handlers, tg)
        expect((yield* store.service.get("b"))?.at).toBe(now + RETRY_BACKOFF_MS[i]!)
      }
      now += 1_000_000
      yield* TestClock.setTime(now)
      yield* store.runDue(handlers, tg)
      expect(yield* store.service.get("b")).toBeUndefined()
      expect(alarms.at(-1)).toBeNull()
    })
  )

  it.effect("survives a defect in a handler", () =>
    Effect.gen(function* () {
      const { store } = setup()
      const handlers: ReadonlyArray<JobHandler> = [{ kind: "k", run: () => Effect.die("kaput") }]
      yield* store.service.schedule({ id: "d", kind: "k", at: 1, payload: "" })
      yield* TestClock.setTime(5)
      yield* store.runDue(handlers, tg)
      expect((yield* store.service.get("d"))?.at).toBeGreaterThan(5)
    })
  )
})
