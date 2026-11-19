import { Context, type Effect } from "effect"
import type { BotError, StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"

export type ScheduledJob = {
  readonly id: string
  readonly kind: string
  readonly at: number
  readonly payload: string
}

export class Scheduler extends Context.Service<
  Scheduler,
  {
    readonly schedule: (job: ScheduledJob) => Effect.Effect<void, StorageError>
    readonly cancel: (id: string) => Effect.Effect<void, StorageError>
    readonly get: (id: string) => Effect.Effect<ScheduledJob | undefined, StorageError>
    readonly list: (kind: string) => Effect.Effect<ReadonlyArray<ScheduledJob>, StorageError>
  }
>()("@bot/Scheduler") {}

export type JobContext = {
  readonly tgId: TgId
  readonly now: number
}

export type JobHandler<R = never> = {
  readonly kind: string
  readonly run: (job: ScheduledJob, ctx: JobContext) => Effect.Effect<void, BotError, R>
}
