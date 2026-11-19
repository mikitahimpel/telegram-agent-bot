import { Context, type Effect } from "effect"
import type { ContainerDown, StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"
import type { UsageSummary } from "./sessions.ts"

export interface AgentInfo {
  readonly tgId: TgId
  readonly sessions: number
  readonly running: number
  readonly usage: UsageSummary
}

/** Cross-account operations for admin commands. Implemented via user-agent DO stubs. */
export class AgentDirectory extends Context.Service<
  AgentDirectory,
  {
    readonly list: Effect.Effect<ReadonlyArray<AgentInfo>, StorageError | ContainerDown>
    readonly info: (tgId: TgId) => Effect.Effect<AgentInfo, StorageError | ContainerDown>
    /** Stop runs and destroy the container. */
    readonly kill: (tgId: TgId) => Effect.Effect<void, StorageError | ContainerDown>
    /** Kill + fresh container on next message (state in R2 is kept). */
    readonly restart: (tgId: TgId) => Effect.Effect<void, StorageError | ContainerDown>
  }
>()("@bot/AgentDirectory") {}
