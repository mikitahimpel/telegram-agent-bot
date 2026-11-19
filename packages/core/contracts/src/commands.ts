import type { Effect } from "effect"
import type { BotError } from "./errors.ts"
import type { ChatId, Role, SessionKey, TgId, ThreadId } from "./ids.ts"
import type { Lang, Localized } from "./lang.ts"

/** Everything a command handler knows about the incoming message. */
export interface CommandContext {
  readonly tgId: TgId
  readonly chatId: ChatId
  readonly threadId: ThreadId | undefined
  readonly sessionKey: SessionKey
  readonly role: Role
  readonly lang: Lang
  /** Text after the command, trimmed ("" when none). */
  readonly args: string
  readonly messageId: number
}

/**
 * One entry of the single command registry. `/help`, the Telegram menu
 * (setMyCommands) and access checks are all derived from the registry.
 * A non-admin invoking an `admin` command is treated as an unknown command.
 */
export interface CommandDef<R = never> {
  /** Without the leading slash, lowercase: "new", "car". */
  readonly name: string
  readonly role: Role
  readonly description: Localized
  /** Usage hint shown in /help, e.g. "<tgId>". */
  readonly usage?: Localized
  /** Hidden commands work but are not shown in the menu (e.g. confirmation flows). */
  readonly hidden?: boolean
  readonly handler: (ctx: CommandContext) => Effect.Effect<void, BotError, R>
}

/** Inline-button callback (`callback_data` = `<prefix>:<payload>`, ≤ 64 bytes). */
export interface CallbackDef<R = never> {
  readonly prefix: string
  readonly role: Role
  readonly handler: (
    ctx: Omit<CommandContext, "args"> & { readonly payload: string; readonly callbackId: string }
  ) => Effect.Effect<void, BotError, R>
}
