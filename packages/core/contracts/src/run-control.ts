import { Context, type Effect } from "effect"
import type { SessionKey } from "./ids.ts"

export class RunControl extends Context.Service<
  RunControl,
  {
    readonly stop: (key: SessionKey) => Effect.Effect<boolean>
    readonly stopAll: Effect.Effect<number>
    readonly running: Effect.Effect<ReadonlyArray<SessionKey>>
  }
>()("@bot/RunControl") {}
