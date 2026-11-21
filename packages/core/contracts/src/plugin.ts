import type { Effect, Layer, Schema } from "effect"
import type { CallbackDef, CommandDef } from "./commands.ts"
import type { StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"
import type { Lang, Localized } from "./lang.ts"
import type { JobHandler } from "./scheduler.ts"

export type ToolContext = {
  readonly tgId: TgId
  readonly lang?: Lang
}

export type AgentTool<R = never> = {
  readonly name: string
  readonly description: string
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly input: Schema.Codec<any, any, never, never>
  readonly handler: (input: unknown, ctx: ToolContext) => Effect.Effect<unknown, StorageError, R>
}

export type BotPlugin<R = never, LayerE = never, LayerR = never> = {
  readonly id: string
  readonly title: Localized
  readonly commands: ReadonlyArray<CommandDef<R>>
  readonly callbacks: ReadonlyArray<CallbackDef<R>>
  readonly tools: ReadonlyArray<AgentTool<R>>
  readonly jobs?: ReadonlyArray<JobHandler<R>>
  readonly layer: Layer.Layer<R, LayerE, LayerR>
  readonly blurb?: Localized
  readonly systemPrompt?: string
  readonly enabledByDefault: boolean
}

export type PluginFlags = {
  readonly isEnabled: (pluginId: string, tgId: TgId) => Effect.Effect<boolean, StorageError>
  readonly setEnabled: (pluginId: string, tgId: TgId, enabled: boolean) => Effect.Effect<void, StorageError>
}
