import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { TgId } from "@bot/core-contracts/ids"
import { BUDGET_TOKENS, estimateTokens, makeMemoryStore, renderBlock } from "../src/memory-store.ts"
import { layerLocal, UserMemory } from "../src/user-memory.ts"

const setup = (budget?: number) => {
  const db = new DatabaseSync(":memory:")
  const sql = { exec: (q: string, ...b: Array<any>) => ({ toArray: () => db.prepare(q).all(...b) as Array<any> }) }
  return makeMemoryStore(sql, budget)
}

describe("memory store", () => {
  it("estimates tokens as chars over four", () => {
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
    expect(estimateTokens("")).toBe(0)
  })

  it.effect("remembers, updates and forgets facts with timestamps", () =>
    Effect.gen(function* () {
      const store = setup()
      yield* TestClock.setTime(1000)
      const a = yield* store.remember("  Name is   Mikita ")
      expect(a).toMatchObject({ ok: true, fact: { id: 1, text: "Name is Mikita", createdAt: 1000, updatedAt: 1000 } })
      yield* TestClock.setTime(2000)
      yield* store.remember("Lives in Warsaw")
      const updated = yield* store.update(1, "Name is Nikita")
      expect(updated).toMatchObject({ ok: true, fact: { id: 1, text: "Name is Nikita", createdAt: 1000, updatedAt: 2000 } })
      expect((yield* store.list).map((f) => f.text)).toEqual(["Name is Nikita", "Lives in Warsaw"])
      expect(yield* store.forget(2)).toBe(true)
      expect(yield* store.forget(2)).toBe(false)
      expect(yield* store.update(9, "x")).toEqual({ ok: false, reason: "not_found" })
      expect(yield* store.remember("   ")).toEqual({ ok: false, reason: "empty" })
      expect(yield* store.forgetAll).toBe(1)
      expect(yield* store.list).toEqual([])
    }))

  it.effect("refuses writes over the budget and allows shrinking an update", () =>
    Effect.gen(function* () {
      const store = setup(10)
      expect(yield* store.remember("a".repeat(24))).toMatchObject({ ok: true, usedTokens: 6 })
      const over = yield* store.remember("b".repeat(20))
      expect(over).toEqual({ ok: false, reason: "over_budget", usedTokens: 6, budgetTokens: 10, neededTokens: 5 })
      const grow = yield* store.update(1, "c".repeat(44))
      expect(grow).toMatchObject({ ok: false, reason: "over_budget" })
      expect(yield* store.update(1, "c".repeat(40))).toMatchObject({ ok: true, usedTokens: 10 })
      expect((yield* store.list).length).toBe(1)
    }))

  it.effect("renders the block with usage and ids", () =>
    Effect.gen(function* () {
      const store = setup()
      expect(yield* store.render).toBe(`MEMORY [0/${BUDGET_TOKENS} tokens]\n(empty)`)
      yield* store.remember("Name is Mikita")
      yield* store.remember("Drives a Skoda")
      expect(yield* store.render).toBe(`MEMORY [8/${BUDGET_TOKENS} tokens]\n[1] Name is Mikita\n[2] Drives a Skoda`)
      expect(renderBlock([], 50)).toBe("MEMORY [0/50 tokens]\n(empty)")
    }))

  it.effect("user memory layer serves only its owner", () => {
    const store = setup()
    return Effect.gen(function* () {
      const um = yield* UserMemory
      expect(um.forUser(TgId.make(1))).toBe(store)
      expect(() => um.forUser(TgId.make(2))).toThrow()
    }).pipe(Effect.provide(layerLocal(TgId.make(1), store)))
  })
})
