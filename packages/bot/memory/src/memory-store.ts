import { Clock, Effect } from "effect"
import { StorageError } from "@bot/core-contracts/errors"

export type MemorySql = {
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly exec: (query: string, ...bindings: Array<any>) => { readonly toArray: () => Array<any> }
}

export type Fact = {
  readonly id: number
  readonly text: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type WriteResult =
  | { readonly ok: true; readonly fact: Fact; readonly usedTokens: number; readonly budgetTokens: number }
  | { readonly ok: false; readonly reason: "empty" }
  | { readonly ok: false; readonly reason: "not_found" }
  | {
      readonly ok: false
      readonly reason: "over_budget"
      readonly usedTokens: number
      readonly budgetTokens: number
      readonly neededTokens: number
    }

export type MemoryStore = {
  readonly list: Effect.Effect<ReadonlyArray<Fact>, StorageError>
  readonly remember: (text: string) => Effect.Effect<WriteResult, StorageError>
  readonly update: (id: number, text: string) => Effect.Effect<WriteResult, StorageError>
  readonly forget: (id: number) => Effect.Effect<boolean, StorageError>
  readonly forgetAll: Effect.Effect<number, StorageError>
  readonly render: Effect.Effect<string, StorageError>
}

export const BUDGET_TOKENS = 2000
export const MAX_FACT_CHARS = 400

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export const totalTokens = (facts: ReadonlyArray<{ readonly text: string }>): number =>
  facts.reduce((sum, f) => sum + estimateTokens(f.text), 0)

export const renderBlock = (facts: ReadonlyArray<Fact>, budget: number = BUDGET_TOKENS): string => {
  const header = `MEMORY [${totalTokens(facts)}/${budget} tokens]`
  return facts.length === 0 ? `${header}\n(empty)` : [header, ...facts.map((f) => `[${f.id}] ${f.text}`)].join("\n")
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS memory_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`
]

const toFact = (row: Record<string, unknown>): Fact => ({
  id: Number(row["id"]),
  text: String(row["text"]),
  createdAt: Number(row["created_at"]),
  updatedAt: Number(row["updated_at"])
})

const attempt = <A>(operation: string, f: () => A) =>
  Effect.try({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_CHARS)

export const makeMemoryStore = (sql: MemorySql, budget: number = BUDGET_TOKENS): MemoryStore => {
  for (const statement of SCHEMA) sql.exec(statement).toArray()

  const list = attempt("memory.list", () =>
    sql.exec("SELECT id, text, created_at, updated_at FROM memory_facts ORDER BY id").toArray().map(toFact)
  )

  const overBudget = (used: number, needed: number): WriteResult => ({
    ok: false,
    reason: "over_budget",
    usedTokens: used,
    budgetTokens: budget,
    neededTokens: needed
  })

  const remember = (raw: string) =>
    Effect.gen(function* () {
      const text = normalize(raw)
      if (text === "") return { ok: false, reason: "empty" } as WriteResult
      const facts = yield* list
      const used = totalTokens(facts)
      const needed = estimateTokens(text)
      if (used + needed > budget) return overBudget(used, needed)
      const now = yield* Clock.currentTimeMillis
      const rows = yield* attempt("memory.remember", () =>
        sql
          .exec("INSERT INTO memory_facts (text, created_at, updated_at) VALUES (?, ?, ?) RETURNING id", text, now, now)
          .toArray()
      )
      const fact: Fact = { id: Number(rows[0]?.["id"]), text, createdAt: now, updatedAt: now }
      return { ok: true, fact, usedTokens: used + needed, budgetTokens: budget } as WriteResult
    })

  const update = (id: number, raw: string) =>
    Effect.gen(function* () {
      const text = normalize(raw)
      if (text === "") return { ok: false, reason: "empty" } as WriteResult
      const facts = yield* list
      const current = facts.find((f) => f.id === id)
      if (current === undefined) return { ok: false, reason: "not_found" } as WriteResult
      const others = totalTokens(facts.filter((f) => f.id !== id))
      const needed = estimateTokens(text)
      if (others + needed > budget) return overBudget(totalTokens(facts), needed)
      const now = yield* Clock.currentTimeMillis
      yield* attempt(
        "memory.update",
        () => void sql.exec("UPDATE memory_facts SET text = ?, updated_at = ? WHERE id = ?", text, now, id).toArray()
      )
      const fact: Fact = { ...current, text, updatedAt: now }
      return { ok: true, fact, usedTokens: others + needed, budgetTokens: budget } as WriteResult
    })

  const forget = (id: number) =>
    Effect.gen(function* () {
      const facts = yield* list
      if (!facts.some((f) => f.id === id)) return false
      yield* attempt("memory.forget", () => void sql.exec("DELETE FROM memory_facts WHERE id = ?", id).toArray())
      return true
    })

  const forgetAll = Effect.gen(function* () {
    const facts = yield* list
    yield* attempt("memory.forget-all", () => void sql.exec("DELETE FROM memory_facts").toArray())
    return facts.length
  })

  return {
    list,
    remember,
    update,
    forget,
    forgetAll,
    render: list.pipe(Effect.map((facts) => renderBlock(facts, budget)))
  }
}
