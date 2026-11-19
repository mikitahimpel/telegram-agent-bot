import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Fiber, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { TelegramError } from "@bot/core-contracts/errors"
import type { ChatId, ThreadId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import { makeTelegram } from "../src/client.ts"
import { layerTest, recordingTelegram } from "../src/testing.ts"
import { sendRichMessage } from "../src/rich.ts"

const chat = 5 as ChatId
const ok = (result: unknown) => ({ body: { ok: true, result } })

describe("Telegram client", () => {
  it.effect("posts JSON to /bot<token>/<method> with HTML + keyboard mapping", () => {
    const { layer, calls } = layerTest(() => ok({ message_id: 42 }))
    return Effect.gen(function* () {
      const tg = yield* Telegram
      const sent = yield* tg.sendMessage({ chatId: chat, threadId: 9 as ThreadId }, "<b>hi</b>", {
        keyboard: [
          [
            { text: "Go", callbackData: "go", style: "primary" },
            { text: "Site", url: "https://x.y" }
          ]
        ],
        replyToMessageId: 3,
        disablePreview: true
      })
      expect(sent).toEqual({ messageId: 42 })
      expect(calls[0]!.url).toBe("https://api.telegram.org/bottest-token/sendMessage")
      expect(calls[0]!.json).toEqual({
        chat_id: 5,
        message_thread_id: 9,
        text: "<b>hi</b>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Go", callback_data: "go", style: "primary" },
              { text: "Site", url: "https://x.y" }
            ]
          ]
        },
        reply_parameters: { message_id: 3 },
        link_preview_options: { is_disabled: true }
      })
    }).pipe(Effect.provide(layer))
  })

  it.effect("sendMessageDraft sets can_stop", () => {
    const { layer, calls } = layerTest(() => ok(true))
    return Effect.gen(function* () {
      yield* (yield* Telegram).sendMessageDraft({ chatId: chat, draftId: 7 }, "x")
      expect(calls[0]!.json).toMatchObject({ draft_id: 7, can_stop: true, parse_mode: "HTML", text: "x" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("sendDocument uses multipart", () => {
    const { layer, calls } = layerTest(() => ok({ message_id: 1 }))
    return Effect.gen(function* () {
      yield* (yield* Telegram).sendDocument(
        { chatId: chat },
        { fileName: "a.md", bytes: new TextEncoder().encode("# hi"), caption: "c" }
      )
      const form = calls[0]!.form!
      expect(form.get("chat_id")).toBe("5")
      expect(form.get("caption")).toBe("c")
      expect((form.get("document") as File).name).toBe("a.md")
      expect(yield* Effect.promise(() => (form.get("document") as File).text())).toBe("# hi")
    }).pipe(Effect.provide(layer))
  })

  it.effect("retries 429 after retry_after seconds", () => {
    let n = 0
    const { layer, calls } = layerTest(() =>
      ++n < 3
        ? {
            status: 429,
            body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 5 } }
          }
        : ok({ message_id: 1 })
    )
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild((yield* Telegram).sendMessage({ chatId: chat }, "x"))
      yield* TestClock.adjust("4 seconds")
      expect(calls.length).toBe(1)
      yield* TestClock.adjust("1 second")
      expect(calls.length).toBe(2)
      yield* TestClock.adjust("5 seconds")
      const r = yield* Effect.exit(Fiber.join(fiber))
      expect(Exit.isSuccess(r)).toBe(true)
      expect(calls.length).toBe(3)
    }).pipe(Effect.provide(layer))
  })

  it.effect("gives up after 3 retries with TelegramError 429", () => {
    const { layer, calls } = layerTest(() => ({
      status: 429,
      body: { ok: false, error_code: 429, description: "slow", parameters: { retry_after: 1 } }
    }))
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip((yield* Telegram).sendMessage({ chatId: chat }, "x")))
      yield* TestClock.adjust("10 seconds")
      const err = yield* Fiber.join(fiber)
      expect(calls.length).toBe(4)
      expect(err).toMatchObject({ _tag: "TelegramError", errorCode: 429, method: "sendMessage" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("maps API errors without retry", () => {
    const { layer, calls } = layerTest(() => ({
      status: 400,
      body: { ok: false, error_code: 400, description: "Bad Request: chat not found" }
    }))
    return Effect.gen(function* () {
      const e = yield* Effect.flip((yield* Telegram).sendChatAction({ chatId: chat }, "typing"))
      expect(e).toEqual(
        new TelegramError({ method: "sendChatAction", errorCode: 400, description: "Bad Request: chat not found" })
      )
      expect(calls.length).toBe(1)
    }).pipe(Effect.provide(layer))
  })

  it.effect("tolerates 'message is not modified' on edit", () => {
    const { layer } = layerTest(() => ({
      status: 400,
      body: { ok: false, error_code: 400, description: "Bad Request: message is not modified" }
    }))
    return Effect.gen(function* () {
      yield* (yield* Telegram).editMessageText({ chatId: chat, messageId: 1 }, "x")
    }).pipe(Effect.provide(layer))
  })

  it.effect("non-JSON body becomes TelegramError", () => {
    const { layer } = layerTest(() => ({ status: 502, body: "x" }))
    return Effect.gen(function* () {
      const e = yield* Effect.flip((yield* Telegram).sendMessage({ chatId: chat }, "x"))
      expect(e.errorCode).toBe(502)
    }).pipe(Effect.provide(layer))
  })

  it.effect("createForumTopic / setMyCommands / answerCallbackQuery", () => {
    const { layer, calls } = layerTest((c) =>
      c.apiMethod === "createForumTopic" ? ok({ message_thread_id: 77 }) : ok(true)
    )
    return Effect.gen(function* () {
      const tg = yield* Telegram
      expect(yield* tg.createForumTopic(chat, "t")).toEqual({ threadId: 77 })
      yield* tg.setMyCommands([{ command: "a", description: "b" }], { type: "chat", chatId: chat }, "ru")
      yield* tg.answerCallbackQuery("id", "txt")
      expect(calls[1]!.json).toEqual({
        commands: [{ command: "a", description: "b" }],
        scope: { type: "chat", chat_id: 5 },
        language_code: "ru"
      })
      expect(calls[2]!.json).toEqual({ callback_query_id: "id", text: "txt" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("sendRichMessage goes through Telegram.call", () => {
    const { layer, calls } = layerTest(() => ok({ message_id: 8 }))
    return Effect.gen(function* () {
      const r = yield* sendRichMessage({ chatId: chat }, "<table></table>", [[{ text: "a", callbackData: "b" }]])
      expect(r).toEqual({ messageId: 8 })
      expect(calls[0]!.apiMethod).toBe("sendRichMessage")
      expect(calls[0]!.json).toMatchObject({
        rich_message: { html: "<table></table>" },
        reply_markup: { inline_keyboard: [[{ text: "a", callback_data: "b" }]] }
      })
    }).pipe(Effect.provide(layer))
  })
})

describe("recordingTelegram", () => {
  it.effect("records and can fail", () => {
    const { layer, calls } = recordingTelegram({
      fail: (c) =>
        c.method === "sendMessageDraft"
          ? new TelegramError({ method: c.method, errorCode: 400, description: "x" })
          : undefined
    })
    return Effect.gen(function* () {
      const tg = yield* Telegram
      expect(yield* tg.sendMessage({ chatId: chat }, "a")).toEqual({ messageId: 1 })
      const e = yield* Effect.flip(tg.sendMessageDraft({ chatId: chat, draftId: 1 }, "a"))
      expect(e.errorCode).toBe(400)
      expect(calls.map((c) => c.method)).toEqual(["sendMessage", "sendMessageDraft"])
    }).pipe(Effect.provide(layer))
  })
})

describe("Telegram files", () => {
  it.effect("getFile maps file_path and file_size", () => {
    const { layer, calls } = layerTest(() =>
      ok({ file_id: "x", file_unique_id: "u", file_path: "voice/f.oga", file_size: 5 })
    )
    return Effect.gen(function* () {
      const tg = yield* Telegram
      const info = yield* tg.getFile("x")
      expect(info).toEqual({ filePath: "voice/f.oga", fileSize: 5 })
      expect(calls[0]?.json).toEqual({ file_id: "x" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("downloadFile fetches /file/bot<token>/<path> bytes", () => {
    const urls: Array<string> = []
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        urls.push(request.url)
        return HttpClientResponse.fromWeb(request, new Response(new Uint8Array([7, 8, 9]), { status: 200 }))
      })
    )
    const layer = Layer.effect(Telegram, makeTelegram(Redacted.make("test-token"))).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, http))
    )
    return Effect.gen(function* () {
      const bytes = yield* (yield* Telegram).downloadFile("voice/f.oga")
      expect([...bytes]).toEqual([7, 8, 9])
      expect(urls[0]).toBe("https://api.telegram.org/file/bottest-token/voice/f.oga")
    }).pipe(Effect.provide(layer))
  })

  it.effect("downloadFile errors never contain the token", () => {
    const http = HttpClient.make((request) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, new Response("nope", { status: 404 })))
    )
    const layer = Layer.effect(Telegram, makeTelegram(Redacted.make("secret-token-123"))).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, http))
    )
    return Effect.gen(function* () {
      const e = yield* Effect.flip((yield* Telegram).downloadFile("voice/f.oga"))
      expect(e.errorCode).toBe(404)
      expect(JSON.stringify(e)).not.toContain("secret-token-123")
    }).pipe(Effect.provide(layer))
  })
})
