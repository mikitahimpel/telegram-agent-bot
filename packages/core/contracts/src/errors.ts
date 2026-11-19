import { Data } from "effect"
import type { TgId } from "./ids.ts"

/** Sender is neither the admin nor on the allowlist. The bot stays silent. */
export class Unauthorized extends Data.TaggedError("Unauthorized")<{
  readonly tgId: TgId
}> {}

/** A run is already in progress for this session. */
export class AgentBusy extends Data.TaggedError("AgentBusy")<{
  readonly sessionKey: string
}> {}

/** The sandbox container could not be reached or crashed. */
export class ContainerDown extends Data.TaggedError("ContainerDown")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

/** A Telegram Bot API call failed (after retries for 429). */
export class TelegramError extends Data.TaggedError("TelegramError")<{
  readonly method: string
  readonly errorCode: number
  readonly description: string
}> {}

/** The Claude subscription usage limit is exhausted. A normal situation, not a crash. */
export class SubscriptionLimitReached extends Data.TaggedError("SubscriptionLimitReached")<{
  /** Epoch milliseconds when the limit resets, if the CLI reported it. */
  readonly resetsAt?: number
}> {}

/** Per-account daily run quota is exhausted. */
export class DailyLimitReached extends Data.TaggedError("DailyLimitReached")<{
  readonly limit: number
}> {}

/** Storage (KV / R2 / DO SQLite) failure. */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly cause?: unknown
}> {}

/** The run was stopped by the user (/stop or MessageGenerationStopped). */
export class RunInterrupted extends Data.TaggedError("RunInterrupted")<{
  readonly sessionKey: string
}> {}

export type BotError =
  | Unauthorized
  | AgentBusy
  | ContainerDown
  | TelegramError
  | SubscriptionLimitReached
  | DailyLimitReached
  | StorageError
  | RunInterrupted
