import { Data } from "effect"
import type { TgId } from "./ids.ts"

export class Unauthorized extends Data.TaggedError("Unauthorized")<{
  readonly tgId: TgId
}> {}

export class AgentBusy extends Data.TaggedError("AgentBusy")<{
  readonly sessionKey: string
}> {}

export class ContainerDown extends Data.TaggedError("ContainerDown")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

export class TelegramError extends Data.TaggedError("TelegramError")<{
  readonly method: string
  readonly errorCode: number
  readonly description: string
}> {}

export class SubscriptionLimitReached extends Data.TaggedError("SubscriptionLimitReached")<{
  readonly resetsAt?: number
}> {}

export class ApiCreditsExhausted extends Data.TaggedError("ApiCreditsExhausted")<{}> {}

export class DailyLimitReached extends Data.TaggedError("DailyLimitReached")<{
  readonly limit: number
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class RunInterrupted extends Data.TaggedError("RunInterrupted")<{
  readonly sessionKey: string
}> {}

export type BotError =
  | Unauthorized
  | AgentBusy
  | ContainerDown
  | TelegramError
  | SubscriptionLimitReached
  | ApiCreditsExhausted
  | DailyLimitReached
  | StorageError
  | RunInterrupted
