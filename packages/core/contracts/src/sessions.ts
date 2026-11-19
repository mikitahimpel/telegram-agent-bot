import { Context, type Effect } from "effect"
import type { DailyLimitReached, StorageError } from "./errors.ts"
import type { ClaudeSessionId, SessionKey, ThreadId } from "./ids.ts"
import type { Lang } from "./lang.ts"

export type SessionRecord = {
  readonly key: SessionKey
  readonly threadId: ThreadId | undefined
  readonly title: string
  readonly claudeSessionId: ClaudeSessionId | undefined
  readonly createdAt: number
  readonly lastUsedAt: number
  readonly runs: number
}

export type RunUsage = {
  readonly sessionKey: SessionKey
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly durationMs: number
  readonly isError: boolean
}

export type UsageSummary = {
  readonly runsToday: number
  readonly dailyLimit: number
  readonly runsTotal: number
  readonly costUsdTotal: number
  readonly inputTokensTotal: number
  readonly outputTokensTotal: number
  readonly lastRunAt: number | undefined
}

export class Sessions extends Context.Service<
  Sessions,
  {
    readonly get: (key: SessionKey) => Effect.Effect<SessionRecord | undefined, StorageError>
    readonly ensure: (
      key: SessionKey,
      threadId: ThreadId | undefined,
      title?: string
    ) => Effect.Effect<SessionRecord, StorageError>
    readonly setClaudeSessionId: (key: SessionKey, id: ClaudeSessionId) => Effect.Effect<void, StorageError>
    readonly reset: (key: SessionKey) => Effect.Effect<void, StorageError>
    readonly list: Effect.Effect<ReadonlyArray<SessionRecord>, StorageError>
    readonly checkDailyLimit: Effect.Effect<void, DailyLimitReached | StorageError>
    readonly recordRun: (usage: RunUsage) => Effect.Effect<void, StorageError>
    readonly usage: Effect.Effect<UsageSummary, StorageError>
    readonly getLang: Effect.Effect<Lang | undefined, StorageError>
    readonly setLang: (lang: Lang) => Effect.Effect<void, StorageError>
  }
>()("@bot/Sessions") {}
