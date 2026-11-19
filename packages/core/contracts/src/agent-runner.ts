import { Context, type Effect, type Stream } from "effect"
import type { AgentEvent } from "./agent-event.ts"
import type { ApiCreditsExhausted, ContainerDown, SubscriptionLimitReached } from "./errors.ts"
import type { ClaudeSessionId, SessionKey, TgId } from "./ids.ts"
import type { Lang } from "./lang.ts"

export type Attachment = {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export type RunInput = {
  readonly tgId: TgId
  readonly sessionKey: SessionKey
  readonly resume: ClaudeSessionId | undefined
  readonly prompt: string
  readonly attachments?: ReadonlyArray<Attachment>
  readonly lang: Lang
  readonly memory?: string
  readonly mcp: { readonly url: string; readonly token: string } | undefined
}

export class AgentRunner extends Context.Service<
  AgentRunner,
  {
    readonly run: (input: RunInput) => Stream.Stream<AgentEvent, ContainerDown | SubscriptionLimitReached | ApiCreditsExhausted>
    readonly restore: (tgId: TgId) => Effect.Effect<void, ContainerDown>
    readonly snapshot: (tgId: TgId) => Effect.Effect<void, ContainerDown>
    readonly destroy: (tgId: TgId) => Effect.Effect<void, ContainerDown>
    readonly readFile: (tgId: TgId, path: string) => Effect.Effect<Uint8Array, ContainerDown>
    readonly health: (tgId: TgId) => Effect.Effect<{ readonly version: string; readonly authOk: boolean }, ContainerDown>
  }
>()("@bot/AgentRunner") {}
