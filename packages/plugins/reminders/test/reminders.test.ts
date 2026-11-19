import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { layerLocal } from "@bot/bot-scheduler/user-scheduler"
import { makeStore } from "@bot/bot-scheduler/scheduler"
import type { CommandContext } from "@bot/core-contracts/commands"
import { ChatId, SessionKey, TgId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import type { Lang } from "@bot/core-contracts/lang"
import type { InlineKeyboard } from "@bot/core-contracts/telegram"
import { FIRED_KIND, REMINDER_KIND, remindersPlugin, type RemindersR } from "../src/reminders.ts"
import { layerKv, makeMemoryKv } from "../src/settings.ts"

const tg = TgId.make(5)

const setup = (lang: Lang | null = "ru") => {
  const db = new DatabaseSync(":memory:")
  const sql = { exec: (q: string, ...b: Array<any>) => ({ toArray: () => db.prepare(q).all(...b) as Array<any> }) }
  const alarms: Array<number | null> = []
  const store = makeStore(sql, {
    setAlarm: async (at) => void alarms.push(at),
    deleteAlarm: async () => void alarms.push(null)
  })
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
  const env: Layer.Layer<RemindersR> = Layer.mergeAll(
    telegram,
    layerLocal(tg, store.service),
    layerKv(makeMemoryKv()),
    Layer.succeed(UserPrefs, {
      timeZone: () => Effect.succeed(undefined),
      lang: () => Effect.succeed(lang ?? undefined)
    })
  )
  return { store, alarms, sent, edits, answers, env }
}

const tool = (name: string) => remindersPlugin.tools.find((t) => t.name === name)!
const call = (name: string, input: unknown) => tool(name).handler(input, { tgId: tg })
const job = remindersPlugin.jobs!.find((j) => j.kind === REMINDER_KIND)!

const callbackCtx = (payload: string, lang: "ru" | "en" = "ru") => ({
  tgId: tg,
  chatId: ChatId.make(5),
  threadId: undefined,
  sessionKey: SessionKey.make("main"),
  role: "user" as const,
  lang,
  messageId: 10,
  payload,
  callbackId: "cb"
})

const NOW = Date.UTC(2026, 10, 19, 10, 0)

describe("reminders tools", () => {
  it.effect("asks for the timezone first, then schedules in local time", () => {
    const { env, store, alarms } = setup()
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const first = (yield* call("reminder_create", { text: "позвонить врачу", at: "2026-11-20T09:00" })) as any
      expect(first.needsTimezone).toBe(true)
      expect(((yield* call("user_get_timezone", {})) as any).timezone).toBeNull()
      expect(((yield* call("user_set_timezone", { tz: "Nope/Zone" })) as any).ok).toBe(false)
      const set = (yield* call("user_set_timezone", { tz: "Europe/Warsaw" })) as any
      expect(set).toMatchObject({ ok: true, nowLocal: "2026-11-19T11:00", weekday: "Thursday" })
      const created = (yield* call("reminder_create", { text: "позвонить врачу", at: "2026-11-20T09:00" })) as any
      expect(created).toMatchObject({ ok: true, firstRunLocal: "2026-11-20T09:00", firstRunWeekday: "Friday" })
      const stored = (yield* store.service.list(REMINDER_KIND))[0]!
      expect(stored.at).toBe(Date.UTC(2026, 10, 20, 8, 0))
      expect(alarms.at(-1)).toBe(stored.at)
      const listed = (yield* call("reminder_list", {})) as any
      expect(listed.reminders).toHaveLength(1)
      expect(listed.reminders[0]).toMatchObject({
        text: "позвонить врачу",
        nextLocal: "2026-11-20T09:00",
        repeat: "none"
      })
      expect(((yield* call("reminder_cancel", { id: created.id })) as any).ok).toBe(true)
      expect(((yield* call("reminder_cancel", { id: created.id })) as any).ok).toBe(false)
      expect(alarms.at(-1)).toBeNull()
    }).pipe(Effect.provide(env))
  })

  it.effect("rejects past and malformed times", () => {
    const { env } = setup()
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
      expect(((yield* call("reminder_create", { text: "x", at: "2026-11-19T10:00" })) as any).error).toContain("past")
      expect(((yield* call("reminder_create", { text: "x", at: "завтра" })) as any).ok).toBe(false)
    }).pipe(Effect.provide(env))
  })
})

describe("reminder firing", () => {
  it.effect("takes the language from the user's setting, not from the text", () =>
    Effect.gen(function* () {
      const fire = (lang: Lang | null, text: string) => {
        const s = setup(lang)
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW)
          yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
          yield* call("reminder_create", { text, at: "2026-11-19T12:00" })
          yield* TestClock.setTime(Date.UTC(2026, 10, 19, 11, 0))
          yield* s.store.runDue([job], tg)
          return s.sent[0]!.keyboard![0]!.map((b) => b.text)
        }).pipe(Effect.provide(s.env))
      }
      expect(yield* fire("en", "позвонить врачу")).toEqual(["✅ Done", "⏰ In an hour", "📅 Tomorrow"])
      expect(yield* fire("ru", "call the doctor")).toEqual(["✅ Готово", "⏰ Через час", "📅 Завтра"])
      expect(yield* fire(null, "позвонить врачу")).toEqual(["✅ Done", "⏰ In an hour", "📅 Tomorrow"])
    })
  )

  it.effect("sends the text with buttons and keeps a fired record for one-off reminders", () => {
    const { env, store, sent } = setup()
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
      const created = (yield* call("reminder_create", { text: "вынести <мусор>", at: "2026-11-19T12:00" })) as any
      yield* TestClock.setTime(Date.UTC(2026, 10, 19, 11, 0))
      yield* store.runDue([job, remindersPlugin.jobs![1]!], tg)
      expect(sent).toHaveLength(1)
      expect(sent[0]!.html).toBe("⏰ вынести &lt;мусор&gt;")
      expect(sent[0]!.keyboard![0]!.map((b) => b.text)).toEqual(["✅ Готово", "⏰ Через час", "📅 Завтра"])
      expect(yield* store.service.list(REMINDER_KIND)).toHaveLength(0)
      expect((yield* store.service.get(created.id))?.kind).toBe(FIRED_KIND)
    }).pipe(Effect.provide(env))
  })

  it.effect("reschedules repeating reminders to the next local occurrence", () => {
    const { env, store } = setup()
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 2, 27, 12, 0))
      yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
      const created = (yield* call("reminder_create", {
        text: "water",
        at: "2026-03-28T09:00",
        repeat: "daily"
      })) as any
      yield* TestClock.setTime(Date.UTC(2026, 2, 28, 8, 5))
      yield* store.runDue([job], tg)
      const next = (yield* store.service.get(created.id))!
      expect(next.kind).toBe(REMINDER_KIND)
      expect(next.at).toBe(Date.UTC(2026, 2, 29, 7, 0))
      yield* TestClock.setTime(Date.UTC(2026, 2, 29, 7, 5))
      yield* store.runDue([job], tg)
      expect((yield* store.service.get(created.id))!.at).toBe(Date.UTC(2026, 2, 30, 7, 0))
    }).pipe(Effect.provide(env))
  })
})

describe("reminder callbacks", () => {
  const cb = remindersPlugin.callbacks[0]!
  const fired = (env: ReturnType<typeof setup>) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
      const created = (yield* call("reminder_create", { text: "позвонить", at: "2026-11-19T12:00" })) as any
      yield* TestClock.setTime(Date.UTC(2026, 10, 19, 11, 0))
      yield* env.store.runDue([job], tg)
      return created.id as string
    })

  it.effect("snooze creates a new one-off an hour later and drops the fired record", () => {
    const s = setup()
    return Effect.gen(function* () {
      const id = yield* fired(s)
      yield* cb.handler(callbackCtx(`snooze:${id}`))
      expect(yield* s.store.service.get(id)).toBeUndefined()
      const [next] = yield* s.store.service.list(REMINDER_KIND)
      expect(next!.at).toBe(Date.UTC(2026, 10, 19, 12, 0))
      expect(s.edits.at(-1)!.keyboard).toEqual([])
    }).pipe(Effect.provide(s.env))
  })

  it.effect("tomorrow moves to 9:00 local the next day", () => {
    const s = setup()
    return Effect.gen(function* () {
      const id = yield* fired(s)
      yield* cb.handler(callbackCtx(`tomorrow:${id}`))
      const [next] = yield* s.store.service.list(REMINDER_KIND)
      expect(next!.at).toBe(Date.UTC(2026, 10, 20, 8, 0))
    }).pipe(Effect.provide(s.env))
  })

  it.effect("done finishes the reminder", () => {
    const s = setup()
    return Effect.gen(function* () {
      const id = yield* fired(s)
      yield* cb.handler(callbackCtx(`done:${id}`))
      expect(yield* s.store.service.get(id)).toBeUndefined()
      expect(s.edits.at(-1)!.html).toBe("✅ позвонить")
    }).pipe(Effect.provide(s.env))
  })

  it.effect("done on an expired reminder answers politely", () => {
    const s = setup()
    return Effect.gen(function* () {
      yield* cb.handler(callbackCtx("done:rem_missing"))
      expect(s.answers.at(-1)).toBe("Это напоминание уже неактуально.")
    }).pipe(Effect.provide(s.env))
  })

  it.effect("cancel from the list removes the reminder and redraws it", () => {
    const s = setup()
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
      const a = (yield* call("reminder_create", { text: "one", at: "2026-11-20T09:00" })) as any
      yield* call("reminder_create", { text: "two", at: "2026-11-21T09:00", repeat: "weekly" })
      yield* cb.handler(callbackCtx(`cancel:${a.id}`, "en"))
      expect(yield* s.store.service.get(a.id)).toBeUndefined()
      expect(s.edits.at(-1)!.html).toContain("two")
      expect(s.edits.at(-1)!.html).toContain("every week")
      expect(s.edits.at(-1)!.keyboard).toHaveLength(1)
    }).pipe(Effect.provide(s.env))
  })
})

describe("/reminders command", () => {
  it.effect("lists reminders with cancel buttons", () => {
    const s = setup()
    const command = remindersPlugin.commands[0]!
    const ctx: CommandContext = {
      tgId: tg,
      chatId: ChatId.make(5),
      threadId: undefined,
      sessionKey: SessionKey.make("main"),
      role: "user",
      lang: "ru",
      args: "",
      messageId: 1
    }
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      yield* command.handler(ctx)
      expect(s.sent.at(-1)!.html).toContain("нет")
      yield* call("user_set_timezone", { tz: "Europe/Warsaw" })
      yield* call("reminder_create", { text: "позвонить врачу", at: "2026-11-20T09:00", repeat: "weekdays" })
      yield* command.handler(ctx)
      const last = s.sent.at(-1)!
      expect(last.html).toContain("по будням")
      expect(last.keyboard![0]![0]!.callbackData).toMatch(/^rem:cancel:rem_/)
    }).pipe(Effect.provide(s.env))
  })
})
