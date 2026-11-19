import { Context, Effect, Layer, Schema } from "effect"
import type { CallbackDef, CommandDef } from "@bot/core-contracts/commands"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"
import { defineMessages } from "@bot/core-contracts/lang"
import type { BotPlugin, PluginFlags as PluginFlagsShape } from "@bot/core-contracts/plugin"
import { Telegram } from "@bot/core-contracts/telegram"
import type { InlineKeyboard, SendTarget } from "@bot/core-contracts/telegram"

export type KvLike = {
  readonly get: (key: string) => Promise<string | null>
  readonly put: (key: string, value: string) => Promise<void>
  readonly delete: (key: string) => Promise<void>
}

export class PluginFlags extends Context.Service<PluginFlags, PluginFlagsShape>()("@bot/PluginFlags") {}

// oxlint-disable-next-line typescript/no-explicit-any
type AnyPlugin = Pick<BotPlugin<any, any, any>, "id" | "title" | "enabledByDefault">

const FlagRecord = Schema.Record(Schema.String, Schema.Boolean)
const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(FlagRecord))

const key = (tgId: TgId) => `plugins:${tgId}`

const makeFlags = (
  plugins: ReadonlyArray<AnyPlugin>,
  load: (tgId: TgId) => Effect.Effect<Record<string, boolean>, StorageError>,
  save: (tgId: TgId, record: Record<string, boolean>) => Effect.Effect<void, StorageError>
): PluginFlagsShape => ({
  isEnabled: (pluginId, tgId) =>
    load(tgId).pipe(
      Effect.map((record) => record[pluginId] ?? plugins.find((p) => p.id === pluginId)?.enabledByDefault ?? false)
    ),
  setEnabled: (pluginId, tgId, enabled) =>
    load(tgId).pipe(Effect.flatMap((record) => save(tgId, { ...record, [pluginId]: enabled })))
})

export const layerKv = (kv: KvLike, plugins: ReadonlyArray<AnyPlugin>): Layer.Layer<PluginFlags> =>
  Layer.succeed(
    PluginFlags,
    makeFlags(
      plugins,
      (tgId) =>
        Effect.tryPromise({
          try: () => kv.get(key(tgId)),
          catch: (cause) => new StorageError({ operation: "plugin-flags.get", cause })
        }).pipe(
          Effect.map((raw) => {
            if (raw === null) return {}
            try {
              return decodeRecord(raw)
            } catch {
              return {}
            }
          })
        ),
      (tgId, record) =>
        Effect.tryPromise({
          try: () => kv.put(key(tgId), JSON.stringify(record)),
          catch: (cause) => new StorageError({ operation: "plugin-flags.put", cause })
        })
    )
  )

export const layerMemory = (plugins: ReadonlyArray<AnyPlugin>): Layer.Layer<PluginFlags> => {
  const store = new Map<TgId, Record<string, boolean>>()
  return Layer.succeed(
    PluginFlags,
    makeFlags(
      plugins,
      (tgId) => Effect.succeed(store.get(tgId) ?? {}),
      (tgId, record) => Effect.sync(() => void store.set(tgId, record))
    )
  )
}

export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const messages = defineMessages({
  en: {
    description: "Manage plugins for an account",
    usage: "<tgId>",
    badId: "Usage: <code>/plugins &lt;tgId&gt;</code>",
    header: (tgId: number) => `Plugins for <code>${tgId}</code>:`,
    enable: (title: string) => `Enable ${title}`,
    disable: (title: string) => `Disable ${title}`,
    none: "No plugins are registered.",
    done: "Done"
  },
  ru: {
    description: "Управление плагинами аккаунта",
    usage: "<tgId>",
    badId: "Использование: <code>/plugins &lt;tgId&gt;</code>",
    header: (tgId: number) => `Плагины для <code>${tgId}</code>:`,
    enable: (title: string) => `Включить ${title}`,
    disable: (title: string) => `Выключить ${title}`,
    none: "Плагины не зарегистрированы.",
    done: "Готово"
  }
})

const parseTgId = (text: string): TgId | undefined => {
  if (!/^-?\d{1,15}$/.test(text)) return undefined
  const n = Number(text)
  return Number.isSafeInteger(n) ? (n as TgId) : undefined
}

export const CALLBACK_PREFIX = "plg"

export const callbackData = (tgId: TgId, pluginId: string, enable: boolean): string =>
  `${CALLBACK_PREFIX}:${tgId}:${pluginId}:${enable ? 1 : 0}`

const target = (ctx: {
  readonly chatId: SendTarget["chatId"]
  readonly threadId: SendTarget["threadId"] | undefined
}): SendTarget => (ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId })

export const makePluginAdmin = (
  plugins: ReadonlyArray<AnyPlugin>
): {
  readonly commands: ReadonlyArray<CommandDef<Telegram | PluginFlags>>
  readonly callbacks: ReadonlyArray<CallbackDef<Telegram | PluginFlags>>
} => {
  const render = (tgId: TgId, lang: "ru" | "en") =>
    Effect.gen(function* () {
      const flags = yield* PluginFlags
      const m = messages[lang]
      if (plugins.length === 0) return { text: m.none, keyboard: [] as InlineKeyboard }
      const rows: Array<{ line: string; button: InlineKeyboard[number][number] }> = []
      for (const p of plugins) {
        const on = yield* flags.isEnabled(p.id, tgId)
        rows.push({
          line: `${on ? "✅" : "⛔"} ${escapeHtml(p.title[lang])} (<code>${escapeHtml(p.id)}</code>)`,
          button: {
            text: on ? m.disable(p.title[lang]) : m.enable(p.title[lang]),
            callbackData: callbackData(tgId, p.id, !on),
            ...(on ? { style: "danger" as const } : { style: "success" as const })
          }
        })
      }
      return {
        text: [m.header(tgId), ...rows.map((r) => r.line)].join("\n"),
        keyboard: rows.map((r) => [r.button]) as InlineKeyboard
      }
    })

  const command: CommandDef<Telegram | PluginFlags> = {
    name: "plugins",
    role: "admin",
    description: { en: messages.en.description, ru: messages.ru.description },
    usage: { en: messages.en.usage, ru: messages.ru.usage },
    handler: (ctx) =>
      Effect.gen(function* () {
        const tg = yield* Telegram
        const id = parseTgId(ctx.args.trim())
        if (id === undefined) {
          yield* tg.sendMessage(target(ctx), messages[ctx.lang].badId)
          return
        }
        const view = yield* render(id, ctx.lang)
        yield* tg.sendMessage(target(ctx), view.text, { keyboard: view.keyboard })
      })
  }

  const callback: CallbackDef<Telegram | PluginFlags> = {
    prefix: CALLBACK_PREFIX,
    role: "admin",
    handler: (ctx) =>
      Effect.gen(function* () {
        const tg = yield* Telegram
        const flags = yield* PluginFlags
        const [idText, pluginId, bit] = ctx.payload.split(":")
        const id = idText === undefined ? undefined : parseTgId(idText)
        if (id === undefined || pluginId === undefined || (bit !== "0" && bit !== "1")) {
          yield* tg.answerCallbackQuery(ctx.callbackId)
          return
        }
        if (plugins.some((p) => p.id === pluginId)) yield* flags.setEnabled(pluginId, id, bit === "1")
        const view = yield* render(id, ctx.lang)
        yield* tg.editMessageText({ ...target(ctx), messageId: ctx.messageId }, view.text, { keyboard: view.keyboard })
        yield* tg.answerCallbackQuery(ctx.callbackId, messages[ctx.lang].done)
      })
  }

  return { commands: [command], callbacks: [callback] }
}
