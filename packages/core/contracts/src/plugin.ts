import type { Effect, Layer, Schema } from "effect"
import type { CallbackDef, CommandDef } from "./commands.ts"
import type { StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"
import type { Localized } from "./lang.ts"

export interface ToolContext {
  readonly tgId: TgId
}

export interface AgentTool<R = never> {
  readonly name: string
  readonly description: string
  readonly input: Schema.Codec<any, any, never, never>
  readonly handler: (input: unknown, ctx: ToolContext) => Effect.Effect<unknown, StorageError, R>
}

export interface BotPlugin<R = never, LayerE = never, LayerR = never> {
  readonly id: string
  readonly title: Localized
  readonly commands: ReadonlyArray<CommandDef<R>>
  readonly callbacks: ReadonlyArray<CallbackDef<R>>
  readonly tools: ReadonlyArray<AgentTool<R>>
  readonly layer: Layer.Layer<R, LayerE, LayerR>
  readonly systemPrompt?: string
  readonly enabledByDefault: boolean
}

export interface PluginFlags {
  readonly isEnabled: (pluginId: string, tgId: TgId) => Effect.Effect<boolean, StorageError>
  readonly setEnabled: (pluginId: string, tgId: TgId, enabled: boolean) => Effect.Effect<void, StorageError>
}
