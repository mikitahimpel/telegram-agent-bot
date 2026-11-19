import { Context, type Effect } from "effect"
import type { TelegramError } from "./errors.ts"
import type { ChatId, ThreadId } from "./ids.ts"
import type { Localized } from "./lang.ts"

/** Inline keyboard button. `style` follows Bot API (e.g. "danger" / "primary" / "success"). */
export interface InlineButton {
  readonly text: string
  readonly callbackData?: string
  readonly url?: string
  /** Opens a Telegram Mini App (HTTPS URL) — Bot API `web_app`. */
  readonly webAppUrl?: string
  readonly style?: "primary" | "success" | "danger"
}

export type InlineKeyboard = ReadonlyArray<ReadonlyArray<InlineButton>>

export interface SendTarget {
  readonly chatId: ChatId
  readonly threadId?: ThreadId
}

/** Text is HTML (parse_mode=HTML). Callers escape user content with the formatter package. */
export interface SendOptions {
  readonly keyboard?: InlineKeyboard
  readonly replyToMessageId?: number
  readonly disablePreview?: boolean
}

export interface SentMessage {
  readonly messageId: number
}

export interface BotCommandEntry {
  readonly command: string
  readonly description: string
}

export type CommandScope =
  | { readonly type: "default" }
  | { readonly type: "chat"; readonly chatId: ChatId }

/**
 * Typed Telegram Bot API client. All methods retry 429 according to `retry_after`.
 * Long texts are NOT split here — use the formatter package's splitter first.
 */
export class Telegram extends Context.Service<
  Telegram,
  {
    /** Raw call for methods without a typed wrapper. Result is `unknown`; decode with Schema. */
    readonly call: (method: string, params: Record<string, unknown>) => Effect.Effect<unknown, TelegramError>
    readonly sendMessage: (to: SendTarget, html: string, options?: SendOptions) => Effect.Effect<SentMessage, TelegramError>
    readonly editMessageText: (
      to: SendTarget & { readonly messageId: number },
      html: string,
      options?: SendOptions
    ) => Effect.Effect<void, TelegramError>
    /** Streams a partial reply (Bot API `sendMessageDraft`). Same `draftId` = same bubble. */
    readonly sendMessageDraft: (
      to: SendTarget & { readonly draftId: number },
      html: string
    ) => Effect.Effect<void, TelegramError>
    readonly sendDocument: (
      to: SendTarget,
      file: { readonly fileName: string; readonly bytes: Uint8Array; readonly caption?: string }
    ) => Effect.Effect<SentMessage, TelegramError>
    readonly sendChatAction: (to: SendTarget, action: "typing" | "upload_document") => Effect.Effect<void, TelegramError>
    readonly createForumTopic: (chatId: ChatId, name: string) => Effect.Effect<{ readonly threadId: ThreadId }, TelegramError>
    readonly answerCallbackQuery: (id: string, text?: string) => Effect.Effect<void, TelegramError>
    readonly setMyCommands: (
      commands: ReadonlyArray<BotCommandEntry>,
      scope: CommandScope,
      languageCode?: string
    ) => Effect.Effect<void, TelegramError>
  }
>()("@bot/Telegram") {}

export type { Localized }
