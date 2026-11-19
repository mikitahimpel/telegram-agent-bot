import { Context, type Effect } from "effect"
import type { SessionKey } from "./ids.ts"

/** Control of in-flight agent runs inside one user-agent DO (backed by FiberMap). */
export class RunControl extends Context.Service<
  RunControl,
  {
    /** Interrupts the run of this session (kills the CLI process). Returns false if nothing ran. */
    readonly stop: (key: SessionKey) => Effect.Effect<boolean>
    readonly stopAll: Effect.Effect<number>
    readonly running: Effect.Effect<ReadonlyArray<SessionKey>>
  }
>()("@bot/RunControl") {}
