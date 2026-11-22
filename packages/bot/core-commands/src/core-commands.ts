import { Effect } from "effect"
import { escapeHtml } from "@bot/bot-commands/html"
import { renderHelp } from "@bot/bot-commands/help"
import { interactionMessages, menuKeyboard } from "@bot/bot-commands/interaction"
import { newTopicKeyboard } from "@bot/bot-commands/messages"
import type { CallbackDef, CommandContext, CommandDef } from "@bot/core-contracts/commands"
import { AgentDirectory, type AgentInfo } from "@bot/core-contracts/agent-directory"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { TelegramError } from "@bot/core-contracts/errors"
import { sessionKeyOf, TgId, type ChatId, type ThreadId } from "@bot/core-contracts/ids"
import { Lang } from "@bot/core-contracts/lang"
import { PluginPrompts } from "@bot/core-contracts/plugin-prompts"
import { RunControl } from "@bot/core-contracts/run-control"
import { Sessions } from "@bot/core-contracts/sessions"
import { Telegram, type InlineKeyboard, type SendTarget } from "@bot/core-contracts/telegram"
import { Schema } from "effect"
import { HelpRegistry } from "./help-registry.ts"
import { formatDateTime, messages } from "./messages.ts"
import { renderWelcome } from "./welcome.ts"

export type CoreR = Telegram | Sessions | Allowlist | AgentDirectory | RunControl | HelpRegistry

const target = (ctx: { readonly chatId: ChatId; readonly threadId: ThreadId | undefined }): SendTarget =>
  ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId }

const reply = (ctx: CommandContext, html: string, keyboard?: InlineKeyboard) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    yield* tg.sendMessage(target(ctx), html, keyboard === undefined ? undefined : { keyboard })
  })

const parseTgId = (raw: string): TgId | undefined =>
  /^\d{1,15}$/.test(raw.trim()) ? TgId.make(Number(raw.trim())) : undefined

const isLang = Schema.is(Lang)

const confirmKeyboard = (confirmText: string, confirmData: string, cancelText: string): InlineKeyboard => [
  [
    { text: confirmText, callbackData: confirmData, style: "danger" },
    { text: cancelText, callbackData: "cancel:", style: "primary" }
  ]
]

const money = (n: number) => n.toFixed(2)

const pad = (cols: ReadonlyArray<string>, widths: ReadonlyArray<number>) =>
  cols
    .map((c, i) => c.padEnd(widths[i] ?? 0))
    .join("  ")
    .trimEnd()

const table = (header: string, rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const head = header.split(" | ")
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)))
  return `<pre>${escapeHtml([pad(head, widths), ...rows.map((r) => pad(r, widths))].join("\n"))}</pre>`
}

const whoOf = (a: AgentInfo) =>
  a.name === undefined && a.username === undefined
    ? "-"
    : [a.name, a.username === undefined ? undefined : `@${a.username}`].filter((x) => x !== undefined).join(" ")

const todayOf = (a: AgentInfo) => `${a.usage.runsToday}/${a.usage.dailyLimit}`

const start: CommandDef<CoreR> = {
  name: "start",
  role: "user",
  description: { en: "Greeting and quick start", ru: "Приветствие и быстрый старт" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const registry = yield* HelpRegistry
      const tg = yield* Telegram
      const blurbs = yield* registry.blurbsFor(ctx.tgId, ctx.lang)
      yield* tg.sendMessage(target(ctx), renderWelcome(undefined, ctx.lang, blurbs, ctx.role === "admin"), {
        replyKeyboard: newTopicKeyboard(ctx.lang)
      })
      const car = yield* registry.pluginEnabled("car", ctx.tgId)
      const m = interactionMessages[ctx.lang]
      yield* tg.sendMessage(target(ctx), `${escapeHtml(m.menuIntro)}\n\n${escapeHtml(m.menuTry)}`, {
        keyboard: menuKeyboard(ctx.lang, { car })
      })
    })
}

const help: CommandDef<CoreR> = {
  name: "help",
  role: "user",
  description: { en: "Show available commands", ru: "Показать доступные команды" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const registry = yield* HelpRegistry
      yield* reply(ctx, renderHelp(registry, ctx.role, ctx.lang))
    })
}

const MAX_TOPIC_NAME = 128

const newSession: CommandDef<CoreR> = {
  name: "new",
  role: "admin",
  description: { en: "Start a new session in its own topic", ru: "Новая сессия в отдельном топике" },
  usage: { en: "[title]", ru: "[название]" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const sessions = yield* Sessions
      const m = messages[ctx.lang]
      const title = (ctx.args === "" ? m.newDefaultTitle : ctx.args).slice(0, MAX_TOPIC_NAME)
      const created = yield* tg.createForumTopic(ctx.chatId, title).pipe(
        Effect.map((t) => t.threadId),
        Effect.catchIf(
          (err): err is TelegramError => err._tag === "TelegramError" && err.errorCode === 400,
          () => Effect.as(reply(ctx, m.topicsDisabled), undefined)
        )
      )
      if (created === undefined) return
      yield* sessions.ensure(sessionKeyOf(created), created, title)
      yield* tg.sendMessage({ chatId: ctx.chatId, threadId: created }, m.newCreated(title))
    })
}

const sessionsCmd: CommandDef<CoreR> = {
  name: "sessions",
  role: "admin",
  description: { en: "List your sessions", ru: "Список ваших сессий" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const m = messages[ctx.lang]
      const list = yield* sessions.list
      if (list.length === 0) return yield* reply(ctx, m.sessionsEmpty)
      const lines = list.map((s) =>
        m.sessionLine(s.title, s.runs, formatDateTime(s.lastUsedAt, ctx.lang), s.key === ctx.sessionKey)
      )
      yield* reply(ctx, [m.sessionsHeader, ...lines].join("\n"))
    })
}

const stop: CommandDef<CoreR> = {
  name: "stop",
  role: "user",
  advanced: true,
  description: { en: "Stop the current run", ru: "Остановить текущий запуск" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const control = yield* RunControl
      const stopped = yield* control.stop(ctx.sessionKey)
      const m = messages[ctx.lang]
      yield* reply(ctx, stopped ? m.stopped : m.nothingRunning)
    })
}

const lang: CommandDef<CoreR> = {
  name: "lang",
  role: "user",
  description: { en: "Change interface language", ru: "Сменить язык интерфейса" },
  usage: { en: "[ru|en]", ru: "[ru|en]" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const m = messages[ctx.lang]
      if (ctx.args === "") {
        return yield* reply(ctx, m.langPrompt, [
          [
            { text: "Русский", callbackData: "lang:ru" },
            { text: "English", callbackData: "lang:en" }
          ]
        ])
      }
      const chosen = ctx.args.toLowerCase()
      if (!isLang(chosen)) return yield* reply(ctx, m.langUsage)
      yield* sessions.setLang(chosen)
      yield* reply(ctx, messages[chosen].langChanged)
    })
}

const agents: CommandDef<CoreR> = {
  name: "agents",
  role: "admin",
  description: { en: "List all agents", ru: "Список всех агентов" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const directory = yield* AgentDirectory
      const m = messages[ctx.lang]
      const list = yield* directory.list
      if (list.length === 0) return yield* reply(ctx, m.agentsEmpty)
      const rows = list.map((a) => [
        String(a.tgId),
        whoOf(a),
        String(a.sessions),
        String(a.running),
        todayOf(a),
        String(a.usage.runsTotal),
        `$${money(a.usage.costUsdTotal)}`
      ])
      yield* reply(ctx, table(m.tableAgents, rows))
    })
}

const usage: CommandDef<CoreR> = {
  name: "usage",
  role: "admin",
  description: { en: "Usage of all agents or one", ru: "Использование: все агенты или один" },
  usage: { en: "[tgId]", ru: "[tgId]" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const directory = yield* AgentDirectory
      const m = messages[ctx.lang]
      if (ctx.args === "") {
        const list = yield* directory.list
        if (list.length === 0) return yield* reply(ctx, m.agentsEmpty)
        const rows = list.map((a) => [
          String(a.tgId),
          whoOf(a),
          todayOf(a),
          String(a.usage.runsTotal),
          `$${money(a.usage.costUsdTotal)}`,
          `${a.usage.inputTokensTotal}/${a.usage.outputTokensTotal}`
        ])
        return yield* reply(ctx, table(m.tableUsage, rows))
      }
      const id = parseTgId(ctx.args)
      if (id === undefined) return yield* reply(ctx, m.usageUsage)
      const a = yield* directory.info(id)
      const last = a.usage.lastRunAt === undefined ? m.never : formatDateTime(a.usage.lastRunAt, ctx.lang)
      yield* reply(
        ctx,
        m.usageOne(
          a.tgId,
          whoOf(a),
          todayOf(a),
          a.usage.runsTotal,
          money(a.usage.costUsdTotal),
          a.usage.inputTokensTotal,
          a.usage.outputTokensTotal,
          last
        )
      )
    })
}

const allow: CommandDef<CoreR> = {
  name: "allow",
  role: "admin",
  description: { en: "Grant a user access", ru: "Выдать пользователю доступ" },
  usage: { en: "<tgId>", ru: "<tgId>" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const allowlist = yield* Allowlist
      const m = messages[ctx.lang]
      const id = parseTgId(ctx.args)
      if (id === undefined) return yield* reply(ctx, m.tgIdUsage("allow"))
      if ((yield* allowlist.roleOf(id)) !== undefined) return yield* reply(ctx, m.alreadyAllowed(id))
      yield* allowlist.allow(id, ctx.tgId)
      yield* reply(ctx, m.allowed(id))
    })
}

const revoke: CommandDef<CoreR> = {
  name: "revoke",
  role: "admin",
  description: { en: "Revoke a user's access", ru: "Отозвать доступ у пользователя" },
  usage: { en: "<tgId>", ru: "<tgId>" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const allowlist = yield* Allowlist
      const m = messages[ctx.lang]
      const id = parseTgId(ctx.args)
      if (id === undefined) return yield* reply(ctx, m.tgIdUsage("revoke"))
      if (id === allowlist.adminId) return yield* reply(ctx, m.revokeAdmin)
      yield* reply(ctx, m.revokeAsk(id), confirmKeyboard(m.btnRevoke, `revoke:${id}`, m.btnCancel))
    })
}

const kill: CommandDef<CoreR> = {
  name: "kill",
  role: "admin",
  description: { en: "Stop runs and destroy a user's container", ru: "Остановить запуски и уничтожить контейнер" },
  usage: { en: "<tgId>", ru: "<tgId>" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const m = messages[ctx.lang]
      const id = parseTgId(ctx.args)
      if (id === undefined) return yield* reply(ctx, m.tgIdUsage("kill"))
      yield* reply(ctx, m.killAsk(id), confirmKeyboard(m.btnKill, `kill:${id}`, m.btnCancel))
    })
}

const restart: CommandDef<CoreR> = {
  name: "restart",
  role: "admin",
  description: { en: "Restart a user's agent", ru: "Перезапустить агента пользователя" },
  usage: { en: "<tgId>", ru: "<tgId>" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const directory = yield* AgentDirectory
      const m = messages[ctx.lang]
      const id = parseTgId(ctx.args)
      if (id === undefined) return yield* reply(ctx, m.tgIdUsage("restart"))
      yield* directory.restart(id)
      yield* reply(ctx, m.restarted(id))
    })
}

const limitCmd: CommandDef<CoreR> = {
  name: "limit",
  role: "admin",
  description: { en: "Set a user's daily request limit", ru: "Задать дневной лимит запросов пользователю" },
  usage: { en: "<tgId> <number|default>", ru: "<tgId> <число|default>" },
  handler: (ctx) =>
    Effect.gen(function* () {
      const directory = yield* AgentDirectory
      const m = messages[ctx.lang]
      const [rawId = "", rawValue = ""] = ctx.args.trim().split(/\s+/)
      const id = parseTgId(rawId)
      if (id === undefined) return yield* reply(ctx, m.limitUsage)
      if (rawValue.toLowerCase() === "default") {
        yield* directory.setLimit(id, undefined)
        return yield* reply(ctx, m.limitReset(id))
      }
      const n = /^\d{1,6}$/.test(rawValue) ? Number(rawValue) : undefined
      if (n === undefined) return yield* reply(ctx, m.limitUsage)
      yield* directory.setLimit(id, n)
      yield* reply(ctx, m.limitSet(id, n))
    })
}

const contextCmd: CommandDef<CoreR> = {
  name: "context",
  role: "admin",
  hidden: true,
  description: {
    en: "Show what the agent is told about its abilities",
    ru: "Показать, что агенту известно о его возможностях"
  },
  handler: (ctx) =>
    Effect.gen(function* () {
      const prompts = yield* Effect.serviceOption(PluginPrompts)
      const text =
        prompts._tag === "None"
          ? "(PluginPrompts service is not available)"
          : yield* prompts.value.forUser(ctx.tgId, ctx.lang)
      const shown = text === "" ? "(empty: no plugin is enabled for you)" : text
      const chunk = shown.length > 3500 ? `${shown.slice(0, 3500)}…` : shown
      yield* reply(ctx, `<pre>${escapeHtml(chunk)}</pre>`)
    })
}

export const coreCommands: ReadonlyArray<CommandDef<CoreR>> = [
  start,
  help,
  newSession,
  sessionsCmd,
  stop,
  lang,
  agents,
  usage,
  allow,
  revoke,
  kill,
  restart,
  limitCmd,
  contextCmd
]

type CallbackCtx = Parameters<CallbackDef<CoreR>["handler"]>[0]

const edit = (ctx: CallbackCtx, html: string) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    yield* tg.editMessageText({ ...target(ctx), messageId: ctx.messageId }, html)
  })

const adminCallback =
  (
    run: (ctx: CallbackCtx, id: TgId) => Effect.Effect<string, import("@bot/core-contracts/errors").BotError, CoreR>
  ): CallbackDef<CoreR>["handler"] =>
  (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      if (ctx.role !== "admin") return yield* tg.answerCallbackQuery(ctx.callbackId)
      const id = parseTgId(ctx.payload)
      if (id === undefined) return yield* tg.answerCallbackQuery(ctx.callbackId)
      const html = yield* run(ctx, id).pipe(
        Effect.tapError(() => Effect.ignore(tg.answerCallbackQuery(ctx.callbackId)))
      )
      yield* tg.answerCallbackQuery(ctx.callbackId)
      yield* edit(ctx, html)
    })

const langCallback: CallbackDef<CoreR> = {
  prefix: "lang",
  role: "user",
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const sessions = yield* Sessions
      if (!isLang(ctx.payload)) return yield* tg.answerCallbackQuery(ctx.callbackId)
      const text = messages[ctx.payload].langChanged
      yield* sessions
        .setLang(ctx.payload)
        .pipe(Effect.tapError(() => Effect.ignore(tg.answerCallbackQuery(ctx.callbackId))))
      yield* tg.answerCallbackQuery(ctx.callbackId, text)
      yield* edit(ctx, text)
    })
}

const revokeCallback: CallbackDef<CoreR> = {
  prefix: "revoke",
  role: "admin",
  handler: adminCallback((ctx, id) =>
    Effect.gen(function* () {
      const allowlist = yield* Allowlist
      if (id === allowlist.adminId) return messages[ctx.lang].revokeAdmin
      yield* allowlist.revoke(id)
      return messages[ctx.lang].revoked(id)
    })
  )
}

const revokeAskCallback: CallbackDef<CoreR> = {
  prefix: "revask",
  role: "admin",
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const allowlist = yield* Allowlist
      const m = messages[ctx.lang]
      yield* tg.answerCallbackQuery(ctx.callbackId)
      const id = ctx.role === "admin" ? parseTgId(ctx.payload) : undefined
      if (id === undefined || id === allowlist.adminId) return
      yield* tg.sendMessage(target(ctx), m.revokeAsk(id), {
        keyboard: confirmKeyboard(m.btnRevoke, `revoke:${id}`, m.btnCancel)
      })
    })
}

const killCallback: CallbackDef<CoreR> = {
  prefix: "kill",
  role: "admin",
  handler: adminCallback((ctx, id) =>
    Effect.gen(function* () {
      const directory = yield* AgentDirectory
      yield* directory.kill(id)
      return messages[ctx.lang].killed(id)
    })
  )
}

const cancelCallback: CallbackDef<CoreR> = {
  prefix: "cancel",
  role: "admin",
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      yield* tg.answerCallbackQuery(ctx.callbackId)
      if (ctx.role === "admin") yield* edit(ctx, messages[ctx.lang].cancelled)
    })
}

export const coreCallbacks: ReadonlyArray<CallbackDef<CoreR>> = [
  langCallback,
  revokeCallback,
  revokeAskCallback,
  killCallback,
  cancelCallback
]
