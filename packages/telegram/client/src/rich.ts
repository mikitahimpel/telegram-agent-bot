import { Effect, Schema } from "effect"
import { TelegramError } from "@bot/core-contracts/errors"
import { Telegram, type InlineKeyboard, type SendTarget, type SentMessage } from "@bot/core-contracts/telegram"
import { inlineKeyboardToMarkup } from "./client.ts"

const Sent = Schema.Struct({ message_id: Schema.Number })

/**
 * Bot API 10.1 `sendRichMessage` with `InputRichMessage = { html }`.
 * Rich messages allow up to 32768 characters, tables and expandable quotes.
 */
export const sendRichMessage = (
  to: SendTarget,
  html: string,
  keyboard?: InlineKeyboard
): Effect.Effect<SentMessage, TelegramError, Telegram> =>
  Effect.gen(function*() {
    const telegram = yield* Telegram
    const result = yield* telegram.call("sendRichMessage", {
      chat_id: to.chatId,
      ...(to.threadId !== undefined ? { message_thread_id: to.threadId } : {}),
      rich_message: { html },
      ...(keyboard !== undefined ? { reply_markup: inlineKeyboardToMarkup(keyboard) } : {})
    })
    const m = yield* Schema.decodeUnknownEffect(Sent)(result).pipe(
      Effect.mapError(() => new TelegramError({ method: "sendRichMessage", errorCode: 0, description: "unexpected result shape" }))
    )
    return { messageId: m.message_id }
  })
