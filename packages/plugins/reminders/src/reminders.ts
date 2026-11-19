import { Clock, Effect, Layer, Schema } from "effect"
import type { CallbackDef, CommandDef } from "@bot/core-contracts/commands"
import { StorageError } from "@bot/core-contracts/errors"
import { ChatId, type TgId } from "@bot/core-contracts/ids"
import { defaultLang, type Lang } from "@bot/core-contracts/lang"
import type { AgentTool, BotPlugin } from "@bot/core-contracts/plugin"
import type { JobHandler, ScheduledJob } from "@bot/core-contracts/scheduler"
import { Telegram } from "@bot/core-contracts/telegram"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import type { InlineKeyboard, SendTarget } from "@bot/core-contracts/telegram"
import { UserScheduler } from "@bot/bot-scheduler/user-scheduler"
import { escapeHtml } from "@bot/telegram-format/format"
import { messages, repeatSuffix } from "./messages.ts"
import { ReminderSettings } from "./settings.ts"
import {
  formatHuman,
  formatIsoLocal,
  isValidTimeZone,
  nextRecurrence,
  parseAt,
  REPEATS,
  toInstant,
  toLocal,
  tomorrowAt,
  weekdayOf,
  type Repeat
} from "./tz.ts"

export type RemindersR = Telegram | UserScheduler | ReminderSettings | UserPrefs

export const REMINDER_KIND = "reminder"
export const FIRED_KIND = "reminder_fired"
export const CALLBACK_PREFIX = "rem"
export const SNOOZE_MS = 60 * 60 * 1000
export const FIRED_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const TOMORROW_HOUR = 9
const MAX_PER_USER = 100
const BUTTON_TEXT_LIMIT = 24

const Local = Schema.Struct({
  year: Schema.Number,
  month: Schema.Number,
  day: Schema.Number,
  hour: Schema.Number,
  minute: Schema.Number
})

export const Payload = Schema.Struct({
  text: Schema.String,
  repeat: Schema.Literals(REPEATS),
  tz: Schema.String,
  local: Local,
  anchorDay: Schema.Number
})
export type Payload = typeof Payload.Type

const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Payload))
const encodePayload = (p: Payload) => JSON.stringify(p)

const newId = () => `rem_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`

const fail = (operation: string, message: string) => new StorageError({ operation, cause: new Error(message) })

const target = (ctx: { readonly chatId: SendTarget["chatId"]; readonly threadId: SendTarget["threadId"] | undefined }): SendTarget =>
  ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId }

const callbackData = (action: string, id: string) => `${CALLBACK_PREFIX}:${action}:${id}`

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

const scheduleOnce = (tgId: TgId, id: string, kind: string, at: number, payload: Payload) =>
  Effect.gen(function* () {
    const scheduler = (yield* UserScheduler).forUser(tgId)
    yield* scheduler.schedule({ id, kind, at, payload: encodePayload(payload) })
  })

const payloadOf = (job: ScheduledJob): Payload | undefined => {
  const decoded = decodePayload(job.payload)
  return decoded._tag === "Some" ? decoded.value : undefined
}

const firedKeyboard = (id: string, lang: Lang): InlineKeyboard => {
  const m = messages[lang]
  return [
    [
      { text: m.done, callbackData: callbackData("done", id), style: "success" },
      { text: m.snooze, callbackData: callbackData("snooze", id) },
      { text: m.tomorrow, callbackData: callbackData("tomorrow", id) }
    ]
  ]
}

const fireJob: JobHandler<RemindersR> = {
  kind: REMINDER_KIND,
  run: (job, ctx) =>
    Effect.gen(function* () {
      const payload = payloadOf(job)
      if (payload === undefined) return
      const tg = yield* Telegram
      const lang = (yield* (yield* UserPrefs).lang(ctx.tgId).pipe(Effect.catch(() => Effect.succeed(undefined)))) ?? defaultLang
      yield* tg.sendMessage({ chatId: ChatId.make(ctx.tgId) }, messages[lang].fired(escapeHtml(payload.text)), {
        keyboard: firedKeyboard(job.id, lang)
      })
      const next = nextRecurrence(
        { local: payload.local, anchorDay: payload.anchorDay, repeat: payload.repeat },
        payload.tz,
        ctx.now
      )
      if (next === undefined) {
        yield* scheduleOnce(ctx.tgId, job.id, FIRED_KIND, ctx.now + FIRED_TTL_MS, payload)
        return
      }
      yield* scheduleOnce(ctx.tgId, job.id, REMINDER_KIND, toInstant(next.local, payload.tz), {
        ...payload,
        local: next.local
      })
    })
}

const expireFired: JobHandler<RemindersR> = { kind: FIRED_KIND, run: () => Effect.void }

const oneOff = (tgId: TgId, payload: Payload, at: number) => {
  const local = toLocal(at, payload.tz)
  return scheduleOnce(tgId, newId(), REMINDER_KIND, at, { ...payload, repeat: "none", local, anchorDay: local.day })
}

const listReminders = (tgId: TgId) =>
  Effect.gen(function* () {
    const jobs = yield* (yield* UserScheduler).forUser(tgId).list(REMINDER_KIND)
    const items: Array<{ readonly job: ScheduledJob; readonly payload: Payload }> = []
    for (const job of jobs) {
      const payload = payloadOf(job)
      if (payload !== undefined) items.push({ job, payload })
    }
    return items
  })

const renderList = (tgId: TgId, lang: Lang) =>
  Effect.gen(function* () {
    const m = messages[lang]
    const items = yield* listReminders(tgId)
    if (items.length === 0) return { html: m.empty, keyboard: undefined }
    const lines = items.map(({ job, payload }, i) =>
      m.line(i + 1, escapeHtml(payload.text), formatHuman(job.at, payload.tz, lang), repeatSuffix[lang][payload.repeat])
    )
    const keyboard: InlineKeyboard = items.map(({ job, payload }) => [
      {
        text: m.cancelButton(clip(payload.text, BUTTON_TEXT_LIMIT)),
        callbackData: callbackData("cancel", job.id),
        style: "danger" as const
      }
    ])
    return { html: [m.listHeader(items.length), ...lines].join("\n"), keyboard }
  })

const remindersCommand: CommandDef<RemindersR> = {
  name: "reminders",
  role: "user",
  description: { en: messages.en.description, ru: messages.ru.description },
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const view = yield* renderList(ctx.tgId, ctx.lang)
      yield* tg.sendMessage(target(ctx), view.html, view.keyboard === undefined ? {} : { keyboard: view.keyboard })
    })
}

const removeKeyboard = (ctx: { readonly chatId: SendTarget["chatId"]; readonly threadId: SendTarget["threadId"] | undefined; readonly messageId: number }, html: string) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    yield* tg.editMessageText({ ...target(ctx), messageId: ctx.messageId }, html, { keyboard: [] }).pipe(Effect.ignore)
  })

const reminderCallback: CallbackDef<RemindersR> = {
  prefix: CALLBACK_PREFIX,
  role: "user",
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const scheduler = (yield* UserScheduler).forUser(ctx.tgId)
      const m = messages[ctx.lang]
      const now = yield* Clock.currentTimeMillis
      const sep = ctx.payload.indexOf(":")
      const action = sep === -1 ? ctx.payload : ctx.payload.slice(0, sep)
      const id = sep === -1 ? "" : ctx.payload.slice(sep + 1)
      const job = id === "" ? undefined : yield* scheduler.get(id)
      const payload = job === undefined ? undefined : payloadOf(job)

      if (job === undefined || payload === undefined) {
        yield* tg.answerCallbackQuery(ctx.callbackId, m.gone)
        yield* removeKeyboard(ctx, m.gone)
        return
      }
      const text = escapeHtml(payload.text)
      const settle = job.kind === FIRED_KIND ? scheduler.cancel(job.id) : Effect.void

      switch (action) {
        case "cancel": {
          yield* scheduler.cancel(job.id)
          yield* tg.answerCallbackQuery(ctx.callbackId, m.cancelled)
          const view = yield* renderList(ctx.tgId, ctx.lang)
          yield* tg
            .editMessageText({ ...target(ctx), messageId: ctx.messageId }, view.html, { keyboard: view.keyboard ?? [] })
            .pipe(Effect.ignore)
          return
        }
        case "done": {
          yield* settle
          yield* tg.answerCallbackQuery(ctx.callbackId, m.ok)
          yield* removeKeyboard(ctx, m.markedDone(text))
          return
        }
        case "snooze":
        case "tomorrow": {
          const at = action === "snooze" ? now + SNOOZE_MS : tomorrowAt(now, payload.tz, TOMORROW_HOUR)
          yield* settle
          yield* oneOff(ctx.tgId, payload, at)
          yield* tg.answerCallbackQuery(ctx.callbackId, m.ok)
          yield* removeKeyboard(ctx, m.movedTo(text, formatHuman(at, payload.tz, ctx.lang)))
          return
        }
        default:
          yield* tg.answerCallbackQuery(ctx.callbackId)
      }
    })
}

const CreateInput = Schema.Struct({
  text: Schema.String.annotate({ description: "What to remind about, in the user's language, phrased as the message the user will see" }),
  at: Schema.String.annotate({
    description: "Local date and time in the user's timezone, ISO format without offset, e.g. 2026-11-20T09:00"
  }),
  repeat: Schema.optionalKey(Schema.Literals(REPEATS).annotate({ description: "none (default), daily, weekdays, weekly or monthly" }))
})
const CancelInput = Schema.Struct({ id: Schema.String })
const SetTzInput = Schema.Struct({
  tz: Schema.String.annotate({ description: "IANA timezone name, e.g. Europe/Warsaw" })
})
const NoInput = Schema.Struct({})

const needsTimezone = {
  ok: false,
  needsTimezone: true,
  hint: "The user's timezone is unknown. Ask them once which city they live in, pick the matching IANA timezone, call user_set_timezone, then retry."
}

const nowInfo = (now: number, tz: string) => {
  const local = toLocal(now, tz)
  return {
    nowLocal: formatIsoLocal(local),
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekdayOf(local)]
  }
}

const tools: ReadonlyArray<AgentTool<RemindersR>> = [
  {
    name: "reminder_create",
    description:
      "Create a reminder that the bot will send to the user's chat at the given local time, without involving you. Call user_get_timezone first to know the current local date and time.",
    input: CreateInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const input = raw as typeof CreateInput.Type
        const tz = yield* (yield* ReminderSettings).getTimeZone(ctx.tgId)
        if (tz === undefined) return needsTimezone
        const now = yield* Clock.currentTimeMillis
        const parsed = parseAt(input.at)
        if (parsed === undefined) return { ok: false, error: "Invalid `at`. Use local ISO time like 2026-11-20T09:00", ...nowInfo(now, tz) }
        const at = parsed._tag === "Instant" ? parsed.ms : toInstant(parsed.local, tz)
        if (at <= now) return { ok: false, error: "That time is already in the past", ...nowInfo(now, tz) }
        const text = input.text.trim()
        if (text === "") return { ok: false, error: "text is empty" }
        const scheduler = (yield* UserScheduler).forUser(ctx.tgId)
        if ((yield* scheduler.list(REMINDER_KIND)).length >= MAX_PER_USER) {
          return { ok: false, error: `Too many reminders (limit ${MAX_PER_USER})` }
        }
        const local = toLocal(at, tz)
        const repeat: Repeat = input.repeat ?? "none"
        const id = newId()
        yield* scheduleOnce(ctx.tgId, id, REMINDER_KIND, at, { text, repeat, tz, local, anchorDay: local.day })
        return {
          ok: true,
          id,
          text,
          repeat,
          timezone: tz,
          firstRunLocal: formatIsoLocal(local),
          firstRunWeekday: nowInfo(at, tz).weekday
        }
      })
  },
  {
    name: "reminder_list",
    description: "List the user's active reminders with their ids, local times and repeat rules.",
    input: NoInput,
    handler: (_raw, ctx) =>
      Effect.gen(function* () {
        const items = yield* listReminders(ctx.tgId)
        return {
          reminders: items.map(({ job, payload }) => ({
            id: job.id,
            text: payload.text,
            nextLocal: formatIsoLocal(toLocal(job.at, payload.tz)),
            repeat: payload.repeat,
            timezone: payload.tz
          }))
        }
      })
  },
  {
    name: "reminder_cancel",
    description: "Cancel an active reminder by id (from reminder_list).",
    input: CancelInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const { id } = raw as typeof CancelInput.Type
        const scheduler = (yield* UserScheduler).forUser(ctx.tgId)
        const job = yield* scheduler.get(id)
        if (job === undefined || job.kind !== REMINDER_KIND) return { ok: false, error: "No active reminder with that id" }
        yield* scheduler.cancel(id)
        return { ok: true }
      })
  },
  {
    name: "user_set_timezone",
    description: "Store the user's IANA timezone (e.g. Europe/Warsaw, Europe/Moscow, America/New_York).",
    input: SetTzInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const { tz } = raw as typeof SetTzInput.Type
        const name = tz.trim()
        if (!isValidTimeZone(name)) return { ok: false, error: `Unknown IANA timezone: ${tz}` }
        yield* (yield* ReminderSettings).setTimeZone(ctx.tgId, name)
        const now = yield* Clock.currentTimeMillis
        return { ok: true, timezone: name, ...nowInfo(now, name) }
      })
  },
  {
    name: "user_get_timezone",
    description: "The user's stored timezone and the current local date, time and weekday there.",
    input: NoInput,
    handler: (_raw, ctx) =>
      Effect.gen(function* () {
        const tz = yield* (yield* ReminderSettings).getTimeZone(ctx.tgId)
        const now = yield* Clock.currentTimeMillis
        if (tz === undefined) return { timezone: null, nowUtc: new Date(now).toISOString(), hint: needsTimezone.hint }
        return { timezone: tz, nowUtc: new Date(now).toISOString(), ...nowInfo(now, tz) }
      })
  }
]

const systemPrompt = `Reminders plugin. The user is a non-technical person who says things like "напомни завтра в 9 позвонить врачу" or "каждый понедельник в 8 вынести мусор". Tools:
- user_get_timezone {}: stored IANA timezone plus the current local date, time and weekday. Call it before creating a reminder so that "tomorrow", "in an hour" and weekdays resolve correctly.
- user_set_timezone {tz}: store the timezone. If the timezone is unknown, ask the user once which city they live in, choose the IANA name yourself, store it and continue without asking again.
- reminder_create {text, at, repeat?}: at is local ISO time without offset (2026-11-20T09:00). repeat is none, daily, weekdays, weekly or monthly. Write text as the short message the user will see when it fires, in their language, without "remind me". Use a sensible default time (9:00) only when the user gave none for a date-only request.
- reminder_list {}, reminder_cancel {id}: list and cancel; to change a reminder, cancel it and create a new one.
Delivery happens by itself through the bot with Done / In an hour / Tomorrow buttons; you are not involved when it fires. After creating, confirm in plain words in the user's language with day and time, for example "Хорошо, напомню завтра в 9:00 позвонить врачу" or "Ок, каждый понедельник в 8:00 напомню вынести мусор". Never show ids, ISO strings or tool names to the user.`

const pass = <I, S>(tag: import("effect").Context.Service<I, S>): Layer.Layer<I, never, I> =>
  Layer.effect(tag, Effect.gen(function* () { return yield* tag }) as Effect.Effect<S, never, I>)

export const layer: Layer.Layer<RemindersR, never, RemindersR> = Layer.mergeAll(
  pass(Telegram),
  pass(UserScheduler),
  pass(ReminderSettings),
  pass(UserPrefs)
)

export const remindersPlugin: BotPlugin<RemindersR, never, RemindersR> = {
  id: "reminders",
  title: { en: messages.en.title, ru: messages.ru.title },
  blurb: { en: "remind you about things at the right time", ru: "напоминать вам о делах в нужное время" },
  commands: [remindersCommand],
  callbacks: [reminderCallback],
  tools,
  jobs: [fireJob, expireFired],
  layer,
  systemPrompt,
  enabledByDefault: true
}
