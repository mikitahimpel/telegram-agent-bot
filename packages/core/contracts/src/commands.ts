import type { Effect } from "effect"
import type { BotError } from "./errors.ts"
import type { ChatId, Role, SessionKey, TgId, ThreadId } from "./ids.ts"
import type { Lang, Localized } from "./lang.ts"

export interface CommandContext {
  readonly tgId: TgId
  readonly chatId: ChatId
  readonly threadId: ThreadId | undefined
  readonly sessionKey: SessionKey
  readonly role: Role
  readonly lang: Lang
  readonly args: string
  readonly messageId: number
}

export interface CommandDef<R = never> {
  readonly name: string
  readonly role: Role
  readonly description: Localized
  readonly usage?: Localized
  readonly hidden?: boolean
  readonly handler: (ctx: CommandContext) => Effect.Effect<void, BotError, R>
}

export interface CallbackDef<R = never> {
  readonly prefix: string
  readonly role: Role
  readonly handler: (
    ctx: Omit<CommandContext, "args"> & { readonly payload: string; readonly callbackId: string }
  ) => Effect.Effect<void, BotError, R>
}
