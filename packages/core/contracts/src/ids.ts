import { Schema } from "effect"

export const TgId = Schema.Int.pipe(Schema.brand("TgId"))
export type TgId = typeof TgId.Type

export const ChatId = Schema.Int.pipe(Schema.brand("ChatId"))
export type ChatId = typeof ChatId.Type

export const ThreadId = Schema.Int.pipe(Schema.brand("ThreadId"))
export type ThreadId = typeof ThreadId.Type

export const ClaudeSessionId = Schema.String.pipe(Schema.brand("ClaudeSessionId"))
export type ClaudeSessionId = typeof ClaudeSessionId.Type

export const SessionKey = Schema.String.pipe(Schema.brand("SessionKey"))
export type SessionKey = typeof SessionKey.Type

export const sessionKeyOf = (threadId: ThreadId | undefined): SessionKey =>
  SessionKey.make(threadId === undefined ? "main" : `t${threadId}`)

export const Role = Schema.Literals(["admin", "user"])
export type Role = typeof Role.Type
