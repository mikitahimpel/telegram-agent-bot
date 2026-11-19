import { Effect, Layer, Schema } from "effect"
import type { CallbackDef, CommandDef } from "@bot/core-contracts/commands"
import type { Lang } from "@bot/core-contracts/lang"
import type { TgId } from "@bot/core-contracts/ids"
import type { AgentTool, BotPlugin } from "@bot/core-contracts/plugin"
import { Telegram } from "@bot/core-contracts/telegram"
import type { InlineKeyboard, SendTarget } from "@bot/core-contracts/telegram"
import { BUDGET_TOKENS, totalTokens, type WriteResult } from "@bot/bot-memory/memory-store"
import { UserMemory } from "@bot/bot-memory/user-memory"
import { escapeHtml } from "@bot/telegram-format/format"
import { messages } from "./messages.ts"

export type MemoryR = Telegram | UserMemory

export const CALLBACK_PREFIX = "mem"
const BUTTON_TEXT_LIMIT = 24

const target = (ctx: {
  readonly chatId: SendTarget["chatId"]
  readonly threadId: SendTarget["threadId"] | undefined
}): SendTarget => (ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId })

const callbackData = (action: string) => `${CALLBACK_PREFIX}:${action}`

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

const renderList = (tgId: TgId, lang: Lang) =>
  Effect.gen(function* () {
    const m = messages[lang]
    const facts = yield* (yield* UserMemory).forUser(tgId).list
    if (facts.length === 0) return { html: m.empty, keyboard: [] as InlineKeyboard }
    const lines = facts.map((f, i) => m.line(i + 1, escapeHtml(f.text)))
    const keyboard: InlineKeyboard = [
      ...facts.map((f) => [
        { text: m.forgetButton(clip(f.text, BUTTON_TEXT_LIMIT)), callbackData: callbackData(`forget:${f.id}`) }
      ]),
      [{ text: m.forgetAllButton, callbackData: callbackData("all"), style: "danger" as const }]
    ]
    return { html: [m.listHeader(facts.length, totalTokens(facts), BUDGET_TOKENS), ...lines].join("\n"), keyboard }
  })

const memoryCommand: CommandDef<MemoryR> = {
  name: "memory",
  role: "user",
  description: { en: messages.en.description, ru: messages.ru.description },
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const view = yield* renderList(ctx.tgId, ctx.lang)
      yield* tg.sendMessage(target(ctx), view.html, view.keyboard.length === 0 ? {} : { keyboard: view.keyboard })
    })
}

const memoryCallback: CallbackDef<MemoryR> = {
  prefix: CALLBACK_PREFIX,
  role: "user",
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const store = (yield* UserMemory).forUser(ctx.tgId)
      const m = messages[ctx.lang]
      const at = { ...target(ctx), messageId: ctx.messageId }
      const showList = Effect.gen(function* () {
        const view = yield* renderList(ctx.tgId, ctx.lang)
        yield* tg.editMessageText(at, view.html, { keyboard: view.keyboard }).pipe(Effect.ignore)
      })
      const sep = ctx.payload.indexOf(":")
      const action = sep === -1 ? ctx.payload : ctx.payload.slice(0, sep)
      const arg = sep === -1 ? "" : ctx.payload.slice(sep + 1)

      switch (action) {
        case "forget": {
          const removed = yield* store.forget(Number(arg))
          yield* tg.answerCallbackQuery(ctx.callbackId, removed ? m.forgotten : m.gone)
          yield* showList
          return
        }
        case "all": {
          const count = (yield* store.list).length
          yield* tg.answerCallbackQuery(ctx.callbackId)
          if (count === 0) return yield* showList
          const keyboard: InlineKeyboard = [
            [
              { text: m.confirmAllYes, callbackData: callbackData("yes"), style: "danger" },
              { text: m.confirmAllNo, callbackData: callbackData("back"), style: "primary" }
            ]
          ]
          yield* tg.editMessageText(at, m.confirmAllText(count), { keyboard }).pipe(Effect.ignore)
          return
        }
        case "yes": {
          yield* store.forgetAll
          yield* tg.answerCallbackQuery(ctx.callbackId, m.ok)
          yield* tg.editMessageText(at, m.allForgotten, { keyboard: [] }).pipe(Effect.ignore)
          return
        }
        case "back": {
          yield* tg.answerCallbackQuery(ctx.callbackId)
          yield* showList
          return
        }
        default:
          yield* tg.answerCallbackQuery(ctx.callbackId)
      }
    })
}

const RememberInput = Schema.Struct({
  text: Schema.String.annotate({ description: 'One short fact about the user, e.g. "Drives a Skoda Octavia 2018"' })
})
const UpdateInput = Schema.Struct({
  id: Schema.Number.annotate({ description: "Fact id from memory_list or the MEMORY block" }),
  text: Schema.String.annotate({ description: "The new, complete text of the fact" })
})
const ForgetInput = Schema.Struct({
  id: Schema.Number.annotate({ description: "Fact id from memory_list or the MEMORY block" })
})
const NoInput = Schema.Struct({})

const writeOutcome = (result: WriteResult) => {
  if (result.ok)
    return {
      ok: true,
      id: result.fact.id,
      text: result.fact.text,
      usedTokens: result.usedTokens,
      budgetTokens: result.budgetTokens
    }
  switch (result.reason) {
    case "empty":
      return { ok: false, error: "text is empty" }
    case "not_found":
      return { ok: false, error: "No fact with that id. Use memory_list to see current ids." }
    case "over_budget":
      return {
        ok: false,
        error: `Memory is full (${result.usedTokens}/${result.budgetTokens} tokens, this fact needs ${result.neededTokens}). Merge related facts with memory_update or remove stale ones with memory_forget, then try again.`
      }
  }
}

const tools: ReadonlyArray<AgentTool<MemoryR>> = [
  {
    name: "memory_remember",
    description:
      "Save a new stable personal fact about the user (name, family, health, preferences, car model, city). Keep it short. If a similar fact exists, use memory_update instead.",
    input: RememberInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const { text } = raw as typeof RememberInput.Type
        return writeOutcome(yield* (yield* UserMemory).forUser(ctx.tgId).remember(text))
      })
  },
  {
    name: "memory_update",
    description:
      "Replace the text of an existing fact by id, for example to correct it or to merge several facts into one.",
    input: UpdateInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const { id, text } = raw as typeof UpdateInput.Type
        return writeOutcome(yield* (yield* UserMemory).forUser(ctx.tgId).update(id, text))
      })
  },
  {
    name: "memory_forget",
    description: "Delete a fact by id when it is outdated, wrong or the user asked to forget it.",
    input: ForgetInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const { id } = raw as typeof ForgetInput.Type
        const removed = yield* (yield* UserMemory).forUser(ctx.tgId).forget(id)
        return removed ? { ok: true } : { ok: false, error: "No fact with that id" }
      })
  },
  {
    name: "memory_list",
    description: "List all remembered facts with ids and the memory budget usage.",
    input: NoInput,
    handler: (_raw, ctx) =>
      Effect.gen(function* () {
        const facts = yield* (yield* UserMemory).forUser(ctx.tgId).list
        return {
          facts: facts.map((f) => ({ id: f.id, text: f.text })),
          usedTokens: totalTokens(facts),
          budgetTokens: BUDGET_TOKENS
        }
      })
  }
]

const systemPrompt = `Memory plugin. Tools: memory_remember {text}, memory_update {id, text}, memory_forget {id}, memory_list {}. The MEMORY block in your instructions shows what is stored. Save stable personal facts the user shares (name, family, health, preferences, car model, city) as short facts, update instead of duplicating, and merge or forget facts when memory is full. Never mention these tools to the user.`

const pass = <I, S>(tag: import("effect").Context.Service<I, S>): Layer.Layer<I, never, I> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      return yield* tag
    }) as Effect.Effect<S, never, I>
  )

export const layer: Layer.Layer<MemoryR, never, MemoryR> = Layer.mergeAll(pass(Telegram), pass(UserMemory))

export const memoryPlugin: BotPlugin<MemoryR, never, MemoryR> = {
  id: "memory",
  title: { en: messages.en.title, ru: messages.ru.title },
  blurb: { en: "remember facts about you between conversations", ru: "помнить важное о вас между разговорами" },
  commands: [memoryCommand],
  callbacks: [memoryCallback],
  tools,
  layer,
  systemPrompt,
  enabledByDefault: true
}
