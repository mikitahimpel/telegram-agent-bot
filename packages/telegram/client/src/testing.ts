import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TelegramError } from "@bot/core-contracts/errors"
import type { ChatId, ThreadId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import { makeTelegram } from "./client.ts"

export type MockHttpCall = {
  readonly url: string
  readonly method: string
  readonly apiMethod: string
  readonly json: Record<string, unknown> | undefined
  readonly form: FormData | undefined
}

export type MockHttpReply = {
  readonly status?: number
  readonly body: unknown
}

export const layerTest = (handler: (call: MockHttpCall) => MockHttpReply) => {
  const calls: Array<MockHttpCall> = []
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      let json: Record<string, unknown> | undefined
      let form: FormData | undefined
      if (request.body._tag === "Uint8Array") {
        json = JSON.parse(new TextDecoder().decode(request.body.body)) as Record<string, unknown>
      } else if (request.body._tag === "FormData") {
        form = request.body.formData
      }
      const call: MockHttpCall = {
        url: request.url,
        method: request.method,
        apiMethod: request.url.split("/").pop() ?? "",
        json,
        form
      }
      calls.push(call)
      const reply = handler(call)
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(reply.body), {
          status: reply.status ?? 200,
          headers: { "content-type": "application/json" }
        })
      )
    })
  )
  const layer = Layer.effect(Telegram, makeTelegram(Redacted.make("test-token"))).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http))
  )
  return { layer, calls }
}

export type RecordedCall = {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export type RecordingOptions = {
  readonly fail?: (call: RecordedCall) => TelegramError | undefined
}

export const recordingTelegram = (options: RecordingOptions = {}) => {
  const calls: Array<RecordedCall> = []
  let nextId = 1
  const run = <A>(method: string, args: ReadonlyArray<unknown>, ok: () => A): Effect.Effect<A, TelegramError> =>
    Effect.suspend(() => {
      const call = { method, args }
      calls.push(call)
      const err = options.fail?.(call)
      return err !== undefined ? Effect.fail(err) : Effect.succeed(ok())
    })
  const layer = Layer.succeed(
    Telegram,
    Telegram.of({
      call: (method, params) =>
        run(method, [params], () => (method === "sendRichMessage" ? { message_id: nextId++ } : true)),
      sendMessage: (...args) => run("sendMessage", args, () => ({ messageId: nextId++ })),
      editMessageText: (...args) => run("editMessageText", args, () => undefined),
      sendMessageDraft: (...args) => run("sendMessageDraft", args, () => undefined),
      sendDocument: (...args) => run("sendDocument", args, () => ({ messageId: nextId++ })),
      sendChatAction: (...args) => run("sendChatAction", args, () => undefined),
      getFile: (...args) => run("getFile", args, () => ({ filePath: "files/f.bin", fileSize: 1 })),
      downloadFile: (...args) => run("downloadFile", args, () => new Uint8Array([1])),
      createForumTopic: (...args) => run("createForumTopic", args, () => ({ threadId: 100 as ThreadId })),
      answerCallbackQuery: (...args) => run("answerCallbackQuery", args, () => undefined),
      setMessageReaction: (...args) => run("setMessageReaction", args, () => undefined),
      setMyCommands: (...args) => run("setMyCommands", args, () => undefined)
    })
  )
  return { layer, calls }
}

export type { ChatId }
