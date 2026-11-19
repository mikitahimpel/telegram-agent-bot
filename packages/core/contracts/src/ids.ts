import { Schema } from "effect"

/** Telegram user id; also the Durable Object name of the user's agent (`String(tgId)`). */
export const TgId = Schema.Int.pipe(Schema.brand("TgId"))
export type TgId = typeof TgId.Type

/** Telegram chat id (for private chats equals the user's TgId). */
export const ChatId = Schema.Int.pipe(Schema.brand("ChatId"))
export type ChatId = typeof ChatId.Type

/** Forum topic thread id inside a private chat. One topic = one claude session. */
export const ThreadId = Schema.Int.pipe(Schema.brand("ThreadId"))
export type ThreadId = typeof ThreadId.Type

/** Claude Code CLI session id (passed to `claude --resume`). */
export const ClaudeSessionId = Schema.String.pipe(Schema.brand("ClaudeSessionId"))
export type ClaudeSessionId = typeof ClaudeSessionId.Type

/** Our own session key: `"main"` for the chat without topics, or `"t<threadId>"`. */
export const SessionKey = Schema.String.pipe(Schema.brand("SessionKey"))
export type SessionKey = typeof SessionKey.Type

export const sessionKeyOf = (threadId: ThreadId | undefined): SessionKey =>
  SessionKey.make(threadId === undefined ? "main" : `t${threadId}`)

export const Role = Schema.Literals(["admin", "user"])
export type Role = typeof Role.Type
