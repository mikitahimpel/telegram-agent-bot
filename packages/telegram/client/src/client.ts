import { Config, Context, Data, Duration, Effect, Layer, Redacted, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"
import { TelegramError } from "@bot/core-contracts/errors"
import type { ChatId, ThreadId } from "@bot/core-contracts/ids"
import {
  Telegram,
  type CommandScope,
  type InlineKeyboard,
  type SendOptions,
  type SendTarget
} from "@bot/core-contracts/telegram"

export const DEFAULT_API_BASE = "https://api.telegram.org"
export const MAX_RATE_LIMIT_RETRIES = 3

class RateLimited extends Data.TaggedError("RateLimited")<{
  readonly retryAfterSeconds: number
  readonly error: TelegramError
}> {}

const Envelope = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Unknown),
  error_code: Schema.optionalKey(Schema.Number),
  description: Schema.optionalKey(Schema.String),
  parameters: Schema.optionalKey(Schema.Struct({ retry_after: Schema.optionalKey(Schema.Number) }))
})

const SentMessageResult = Schema.Struct({ message_id: Schema.Number })
const FileResult = Schema.Struct({
  file_path: Schema.optionalKey(Schema.String),
  file_size: Schema.optionalKey(Schema.Number)
})
const TopicResult = Schema.Struct({ message_thread_id: Schema.Number })

export const inlineKeyboardToMarkup = (keyboard: InlineKeyboard) => ({
  inline_keyboard: keyboard.map((row) =>
    row.map((b) => ({
      text: b.text,
      ...(b.callbackData !== undefined ? { callback_data: b.callbackData } : {}),
      ...(b.url !== undefined ? { url: b.url } : {}),
      ...(b.webAppUrl !== undefined ? { web_app: { url: b.webAppUrl } } : {}),
      ...(b.style !== undefined ? { style: b.style } : {})
    }))
  )
})

const targetParams = (to: SendTarget): Record<string, unknown> => ({
  chat_id: to.chatId,
  ...(to.threadId !== undefined ? { message_thread_id: to.threadId } : {})
})

const optionParams = (options: SendOptions | undefined): Record<string, unknown> => ({
  ...(options?.replyKeyboard !== undefined
    ? {
        reply_markup: {
          keyboard: options.replyKeyboard.rows.map((row) => row.map((text) => ({ text }))),
          is_persistent: true,
          resize_keyboard: true
        }
      }
    : {}),
  ...(options?.keyboard !== undefined ? { reply_markup: inlineKeyboardToMarkup(options.keyboard) } : {}),
  ...(options?.replyToMessageId !== undefined ? { reply_parameters: { message_id: options.replyToMessageId } } : {}),
  ...(options?.disablePreview === true ? { link_preview_options: { is_disabled: true } } : {})
})

const retrySchedule = Schedule.recurs(MAX_RATE_LIMIT_RETRIES).pipe(
  Schedule.modifyDelay(({ input }) =>
    Effect.succeed(Duration.seconds(input instanceof RateLimited ? Math.max(input.retryAfterSeconds, 0) : 0))
  )
)

const badResponse = (method: string, description: string, errorCode = 0) =>
  new TelegramError({ method, errorCode, description })

export const makeTelegram = (token: Redacted.Redacted<string>, apiBase: string = DEFAULT_API_BASE) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const base = apiBase.replace(/\/+$/, "")

    const attempt = (method: string, body: HttpBody.HttpBody): Effect.Effect<unknown, TelegramError | RateLimited> =>
      Effect.gen(function* () {
        const request = HttpClientRequest.post(`${base}/bot${Redacted.value(token)}/${method}`).pipe(
          HttpClientRequest.setBody(body)
        )
        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError((e) => badResponse(method, `transport error (${e.reason._tag})`)))
        const text = yield* response.text.pipe(
          Effect.mapError(() => badResponse(method, "unreadable response body", response.status))
        )
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          return yield* Effect.fail(badResponse(method, `non-JSON response (HTTP ${response.status})`, response.status))
        }
        const env = yield* Schema.decodeUnknownEffect(Envelope)(json).pipe(
          Effect.mapError(() =>
            badResponse(method, `unexpected response shape (HTTP ${response.status})`, response.status)
          )
        )
        if (env.ok) return env.result
        const code = env.error_code ?? response.status
        const error = new TelegramError({ method, errorCode: code, description: env.description ?? "unknown error" })
        const retryAfter = env.parameters?.retry_after
        if (code === 429) {
          return yield* Effect.fail(new RateLimited({ retryAfterSeconds: retryAfter ?? 1, error }))
        }
        return yield* Effect.fail(error)
      })

    const send = (method: string, body: HttpBody.HttpBody): Effect.Effect<unknown, TelegramError> =>
      attempt(method, body).pipe(
        Effect.retry({ schedule: retrySchedule, while: (e) => e instanceof RateLimited }),
        Effect.mapError((e) => (e instanceof RateLimited ? e.error : e))
      )

    const call = (method: string, params: Record<string, unknown>) => send(method, HttpBody.jsonUnsafe(params))

    const decode =
      <S extends Schema.Constraint & { readonly DecodingServices: never }>(method: string, schema: S) =>
      (u: unknown) =>
        Schema.decodeUnknownEffect(schema)(u).pipe(
          Effect.mapError(() => badResponse(method, "unexpected result shape"))
        )

    const sendMessage = (to: SendTarget, html: string, options?: SendOptions) =>
      call("sendMessage", { ...targetParams(to), text: html, parse_mode: "HTML", ...optionParams(options) }).pipe(
        Effect.flatMap(decode("sendMessage", SentMessageResult)),
        Effect.map((m) => ({ messageId: m.message_id }))
      )

    const editMessageText = (to: SendTarget & { readonly messageId: number }, html: string, options?: SendOptions) =>
      call("editMessageText", {
        chat_id: to.chatId,
        message_id: to.messageId,
        text: html,
        parse_mode: "HTML",
        ...(options?.keyboard !== undefined ? { reply_markup: inlineKeyboardToMarkup(options.keyboard) } : {}),
        ...(options?.disablePreview === true ? { link_preview_options: { is_disabled: true } } : {})
      }).pipe(
        Effect.asVoid,
        Effect.catchIf(
          (e) => e.errorCode === 400 && e.description.includes("message is not modified"),
          () => Effect.void
        )
      )

    const sendMessageDraft = (to: SendTarget & { readonly draftId: number }, html: string) =>
      call("sendMessageDraft", {
        ...targetParams(to),
        draft_id: to.draftId,
        text: html,
        parse_mode: "HTML",
        can_stop: true
      }).pipe(Effect.asVoid)

    const sendDocument = (
      to: SendTarget,
      file: { readonly fileName: string; readonly bytes: Uint8Array; readonly caption?: string }
    ) => {
      const form = new FormData()
      form.append("chat_id", String(to.chatId))
      if (to.threadId !== undefined) form.append("message_thread_id", String(to.threadId))
      if (file.caption !== undefined) {
        form.append("caption", file.caption)
        form.append("parse_mode", "HTML")
      }
      form.append("document", new Blob([file.bytes as BlobPart]), file.fileName)
      return send("sendDocument", HttpBody.formData(form)).pipe(
        Effect.flatMap(decode("sendDocument", SentMessageResult)),
        Effect.map((m) => ({ messageId: m.message_id }))
      )
    }

    const sendChatAction = (to: SendTarget, action: "typing" | "upload_document") =>
      call("sendChatAction", { ...targetParams(to), action }).pipe(Effect.asVoid)

    const getFile = (fileId: string) =>
      call("getFile", { file_id: fileId }).pipe(
        Effect.flatMap(decode("getFile", FileResult)),
        Effect.flatMap((f) =>
          f.file_path === undefined
            ? Effect.fail(badResponse("getFile", "file has no path"))
            : Effect.succeed({ filePath: f.file_path, fileSize: f.file_size })
        )
      )

    const downloadFile = (filePath: string): Effect.Effect<Uint8Array, TelegramError> =>
      Effect.gen(function* () {
        const request = HttpClientRequest.get(`${base}/file/bot${Redacted.value(token)}/${filePath}`)
        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError((e) => badResponse("downloadFile", `transport error (${e.reason._tag})`)))
        if (response.status !== 200) {
          return yield* Effect.fail(badResponse("downloadFile", `HTTP ${response.status}`, response.status))
        }
        const buffer = yield* response.arrayBuffer.pipe(
          Effect.mapError(() => badResponse("downloadFile", "unreadable response body", response.status))
        )
        return new Uint8Array(buffer)
      })

    const createForumTopic = (chatId: ChatId, name: string) =>
      call("createForumTopic", { chat_id: chatId, name }).pipe(
        Effect.flatMap(decode("createForumTopic", TopicResult)),
        Effect.map((t) => ({ threadId: t.message_thread_id as ThreadId }))
      )

    const answerCallbackQuery = (id: string, text?: string) =>
      call("answerCallbackQuery", { callback_query_id: id, ...(text !== undefined ? { text } : {}) }).pipe(
        Effect.asVoid
      )

    const setMessageReaction = (to: SendTarget & { readonly messageId: number }, emoji: string) =>
      call("setMessageReaction", {
        chat_id: to.chatId,
        message_id: to.messageId,
        reaction: [{ type: "emoji", emoji }]
      }).pipe(Effect.asVoid)

    const setMyCommands = (
      commands: ReadonlyArray<{ readonly command: string; readonly description: string }>,
      scope: CommandScope,
      languageCode?: string
    ) =>
      call("setMyCommands", {
        commands,
        scope: scope.type === "default" ? { type: "default" } : { type: "chat", chat_id: scope.chatId },
        ...(languageCode !== undefined ? { language_code: languageCode } : {})
      }).pipe(Effect.asVoid)

    return Telegram.of({
      call,
      sendMessage,
      editMessageText,
      sendMessageDraft,
      sendDocument,
      sendChatAction,
      getFile,
      downloadFile,
      createForumTopic,
      answerCallbackQuery,
      setMessageReaction,
      setMyCommands
    })
  })

export const layer: Layer.Layer<Telegram, Config.ConfigError, HttpClient.HttpClient> = Layer.effect(
  Telegram,
  Effect.gen(function* () {
    const token = yield* Config.Redacted("TELEGRAM_BOT_TOKEN")
    const apiBase = yield* Config.String("TELEGRAM_API_BASE").pipe(Config.withDefault(DEFAULT_API_BASE))
    return yield* makeTelegram(token, apiBase)
  })
)

export const layerFetch = layer.pipe(Layer.provide(FetchHttpClient.layer))

export type { Context }
