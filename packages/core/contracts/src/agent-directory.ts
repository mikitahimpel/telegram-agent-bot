import { Context, type Effect } from "effect"
import type { ContainerDown, StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"
import type { UsageSummary } from "./sessions.ts"

export interface AgentInfo {
  readonly tgId: TgId
  readonly sessions: number
  readonly running: number
  readonly usage: UsageSummary
  readonly name?: string
  readonly username?: string
}

export class AgentDirectory extends Context.Service<
  AgentDirectory,
  {
    readonly list: Effect.Effect<ReadonlyArray<AgentInfo>, StorageError | ContainerDown>
    readonly info: (tgId: TgId) => Effect.Effect<AgentInfo, StorageError | ContainerDown>
    readonly kill: (tgId: TgId) => Effect.Effect<void, StorageError | ContainerDown>
    readonly restart: (tgId: TgId) => Effect.Effect<void, StorageError | ContainerDown>
  }
>()("@bot/AgentDirectory") {}
