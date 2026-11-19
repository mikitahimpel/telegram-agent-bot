import { Context, type Effect, type Stream } from "effect"
import type { AgentEvent } from "./agent-event.ts"
import type { ContainerDown, SubscriptionLimitReached } from "./errors.ts"
import type { ClaudeSessionId, SessionKey, TgId } from "./ids.ts"
import type { Lang } from "./lang.ts"

export interface RunInput {
  readonly tgId: TgId
  readonly sessionKey: SessionKey
  /** Resume this claude session; undefined starts a new one. */
  readonly resume: ClaudeSessionId | undefined
  readonly prompt: string
  readonly lang: Lang
  /** MCP endpoint + short-lived bearer token bound to tgId (plugin tools). */
  readonly mcp: { readonly url: string; readonly token: string } | undefined
}

/**
 * Runs the Claude Code CLI inside this account's Cloudflare Sandbox.
 * Interrupting the stream's fiber MUST kill the CLI process in the container.
 */
export class AgentRunner extends Context.Service<
  AgentRunner,
  {
    readonly run: (input: RunInput) => Stream.Stream<AgentEvent, ContainerDown | SubscriptionLimitReached>
    /** Restore ~/.claude from R2 (`agents/<tgId>/`). Called before the first run of a container. */
    readonly restore: (tgId: TgId) => Effect.Effect<void, ContainerDown>
    /** Save ~/.claude to R2. Called after runs and before the container sleeps. */
    readonly snapshot: (tgId: TgId) => Effect.Effect<void, ContainerDown>
    /** Kill all processes and destroy the container (admin /kill). */
    readonly destroy: (tgId: TgId) => Effect.Effect<void, ContainerDown>
    /** Read a file the agent produced (to send as a Telegram document). */
    readonly readFile: (tgId: TgId, path: string) => Effect.Effect<Uint8Array, ContainerDown>
    /** `claude --version` + auth check; used by healthcheck. */
    readonly health: (tgId: TgId) => Effect.Effect<{ readonly version: string; readonly authOk: boolean }, ContainerDown>
  }
>()("@bot/AgentRunner") {}
