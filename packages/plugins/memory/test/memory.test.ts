import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { layerLocal } from "@bot/bot-memory/user-memory"
import { makeMemoryStore } from "@bot/bot-memory/memory-store"
import { ChatId, SessionKey, TgId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import type { InlineKeyboard } from "@bot/core-contracts/telegram"
import { memoryPlugin, type MemoryR } from "../src/memory.ts"

const tg = TgId.make(5)

const setup = (budget?: number) => {
  const db = new DatabaseSync(":memory:")
  const sql = { exec: (q: string, ...b: Array<any>) => ({ toArray: () => db.prepare(q).all(...b) as Array<any> }) }
  const store = makeMemoryStore(sql, budget)
  const sent: Array<{ html: string; keyboard: InlineKeyboard | undefined }> = []
  const edits: Array<{ html: string; keyboard: InlineKeyboard | undefined }> = []
  const answers: Array<string | undefined> = []
  const telegram = Layer.succeed(Telegram, {
    sendMessage: (_to: unknown, html: string, options?: { keyboard?: InlineKeyboard }) =>
      Effect.sync(() => (sent.push({ html, keyboard: options?.keyboard }), { messageId: 1 })),
    editMessageText: (_to: unknown, html: string, options?: { keyboard?: InlineKeyboard }) =>
      Effect.sync(() => void edits.push({ html, keyboard: options?.keyboard })),
    answerCallbackQuery: (_id: string, text?: string) => Effect.sync(() => void answers.push(text))
  } as never)
  const env: Layer.Layer<MemoryR> = Layer.mergeAll(telegram, layerLocal(tg, store))
  return { store, sent, edits, answers, env }
}

const tool = (name: string) => memoryPlugin.tools.find((t) => t.name === name)!
const call = (name: string, input: unknown) => tool(name).handler(input, { tgId: tg })
const command = memoryPlugin.commands[0]!
const callback = memoryPlugin.callbacks[0]!

const base = (lang: "ru" | "en") => ({
  tgId: tg,
  chatId: ChatId.make(5),
  threadId: undefined,
  sessionKey: SessionKey.make("main"),
  role: "user" as const,
  lang,
  messageId: 10
})
const runCommand = (lang: "ru" | "en") => command.handler({ ...base(lang), args: "" })
const runCallback = (payload: string, lang: "ru" | "en" = "ru") =>
  callback.handler({ ...base(lang), payload, callbackId: "cb" })

describe("memory tools", () => {
  it("is a core plugin enabled by default with the four tools", () => {
    expect(memoryPlugin.enabledByDefault).toBe(true)
    expect(memoryPlugin.id).toBe("memory")
    expect(memoryPlugin.tools.map((t) => t.name)).toEqual([
      "memory_remember",
      "memory_update",
      "memory_forget",
      "memory_list"
    ])
    expect(memoryPlugin.commands.map((c) => c.name)).toEqual(["memory"])
  })

  it.effect("remembers, lists, updates and forgets", () => {
    const { env } = setup()
    return Effect.gen(function* () {
      const a = (yield* call("memory_remember", { text: "Name is Mikita" })) as any
      expect(a).toMatchObject({ ok: true, id: 1, text: "Name is Mikita", budgetTokens: 2000 })
      yield* call("memory_remember", { text: "Lives in Warsaw" })
      expect(((yield* call("memory_update", { id: 2, text: "Lives in Gdansk" })) as any).ok).toBe(true)
      expect((yield* call("memory_list", {})) as any).toEqual({
        facts: [
          { id: 1, text: "Name is Mikita" },
          { id: 2, text: "Lives in Gdansk" }
        ],
        usedTokens: 8,
        budgetTokens: 2000
      })
      expect(yield* call("memory_forget", { id: 1 })).toEqual({ ok: true })
      expect(((yield* call("memory_forget", { id: 1 })) as any).ok).toBe(false)
      expect(((yield* call("memory_update", { id: 99, text: "x" })) as any).ok).toBe(false)
    }).pipe(Effect.provide(env))
  })

  it.effect("tells the agent to merge or forget when over budget", () => {
    const { env } = setup(5)
    return Effect.gen(function* () {
      yield* call("memory_remember", { text: "a".repeat(16) })
      const full = (yield* call("memory_remember", { text: "b".repeat(16) })) as any
      expect(full.ok).toBe(false)
      expect(full.error).toContain("Memory is full")
      expect(full.error).toContain("memory_update")
      expect(full.error).toContain("memory_forget")
    }).pipe(Effect.provide(env))
  })
})

describe("/memory", () => {
  it.effect("says it is empty when nothing is stored", () => {
    const { env, sent } = setup()
    return Effect.gen(function* () {
      yield* runCommand("ru")
      expect(sent[0]!.html).toContain("ничего о вас не помню")
      expect(sent[0]!.keyboard).toBeUndefined()
    }).pipe(Effect.provide(env))
  })

  it.effect("lists facts with a forget button each and a forget-all button, escaping text", () => {
    const { env, sent } = setup()
    return Effect.gen(function* () {
      yield* call("memory_remember", { text: "Аллергия на <орехи>" })
      yield* call("memory_remember", { text: "Drives a Skoda" })
      yield* runCommand("ru")
      expect(sent[0]!.html).toContain("Что я о вас помню (2)")
      expect(sent[0]!.html).toContain("1. Аллергия на &lt;орехи&gt;")
      const rows = sent[0]!.keyboard!
      expect(rows.map((r) => r[0]!.callbackData)).toEqual(["mem:forget:1", "mem:forget:2", "mem:all"])
      expect(rows[0]![0]!.text.startsWith("Забыть: ")).toBe(true)
      expect(rows[2]![0]!.text).toBe("Забыть всё")
    }).pipe(Effect.provide(env))
  })
})

describe("memory callbacks", () => {
  it.effect("forgets one fact and re-renders the list", () => {
    const { env, edits, answers, store } = setup()
    return Effect.gen(function* () {
      yield* call("memory_remember", { text: "one" })
      yield* call("memory_remember", { text: "two" })
      yield* runCallback("forget:1")
      expect((yield* store.list).map((f) => f.text)).toEqual(["two"])
      expect(answers).toEqual(["Забыто"])
      expect(edits[0]!.html).toContain("2".length > 0 ? "two" : "")
      expect(edits[0]!.keyboard!.map((r) => r[0]!.callbackData)).toEqual(["mem:forget:2", "mem:all"])
      yield* runCallback("forget:1")
      expect(answers[1]).toBe("Этого уже нет.")
    }).pipe(Effect.provide(env))
  })

  it.effect("asks for confirmation before forgetting everything", () => {
    const { env, edits, store } = setup()
    return Effect.gen(function* () {
      yield* call("memory_remember", { text: "one" })
      yield* call("memory_remember", { text: "two" })
      yield* runCallback("all", "en")
      expect((yield* store.list).length).toBe(2)
      expect(edits[0]!.html).toContain("Forget all 2 facts")
      expect(edits[0]!.keyboard![0]!.map((b) => b.callbackData)).toEqual(["mem:yes", "mem:back"])
      yield* runCallback("back", "en")
      expect(edits[1]!.html).toContain("What I remember about you (2)")
      expect((yield* store.list).length).toBe(2)
      yield* runCallback("yes", "en")
      expect(yield* store.list).toEqual([])
      expect(edits[2]!.html).toContain("forgot everything")
      expect(edits[2]!.keyboard).toEqual([])
    }).pipe(Effect.provide(env))
  })
})
