import { Context, type Effect } from "effect"
import type { TelegramError } from "./errors.ts"
import type { ChatId, ThreadId } from "./ids.ts"
import type { Localized } from "./lang.ts"

export interface InlineButton {
  readonly text: string
  readonly callbackData?: string
  readonly url?: string
  readonly webAppUrl?: string
  readonly style?: "primary" | "success" | "danger"
}

export type InlineKeyboard = ReadonlyArray<ReadonlyArray<InlineButton>>

export interface SendTarget {
  readonly chatId: ChatId
  readonly threadId?: ThreadId
}

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

export class Telegram extends Context.Service<
  Telegram,
  {
    readonly call: (method: string, params: Record<string, unknown>) => Effect.Effect<unknown, TelegramError>
    readonly sendMessage: (to: SendTarget, html: string, options?: SendOptions) => Effect.Effect<SentMessage, TelegramError>
    readonly editMessageText: (
      to: SendTarget & { readonly messageId: number },
      html: string,
      options?: SendOptions
    ) => Effect.Effect<void, TelegramError>
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
