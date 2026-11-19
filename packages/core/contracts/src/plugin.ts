import type { Effect, Layer, Schema } from "effect"
import type { CallbackDef, CommandDef } from "./commands.ts"
import type { StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"
import type { Localized } from "./lang.ts"

export interface ToolContext {
  readonly tgId: TgId
}

/** A tool exposed to the agent through our MCP server. Only sees data of `ctx.tgId`. */
export interface AgentTool<R = never> {
  /** snake_case, prefixed with the plugin id: "car_list_trips". */
  readonly name: string
  readonly description: string
  /** Decoded from MCP `arguments`; also converted to JSON Schema for `tools/list`. */
  readonly input: Schema.Codec<any, any, never, never>
  readonly handler: (input: unknown, ctx: ToolContext) => Effect.Effect<unknown, StorageError, R>
}

/**
 * A plugin adds commands, callbacks and agent tools without touching the core.
 * `R` = services the plugin needs; `layer` provides them from the core environment.
 */
export interface BotPlugin<R = never, LayerE = never, LayerR = never> {
  readonly id: string
  readonly title: Localized
  readonly commands: ReadonlyArray<CommandDef<R>>
  readonly callbacks: ReadonlyArray<CallbackDef<R>>
  readonly tools: ReadonlyArray<AgentTool<R>>
  readonly layer: Layer.Layer<R, LayerE, LayerR>
  /** Extra text appended to the agent's system prompt when the plugin is enabled. */
  readonly systemPrompt?: string
  /** Default when the admin has not set an explicit flag for the account. */
  readonly enabledByDefault: boolean
}

/** Per-account plugin flags (admin-managed; stored in KV `plugins:<tgId>`). */
export interface PluginFlags {
  readonly isEnabled: (pluginId: string, tgId: TgId) => Effect.Effect<boolean, StorageError>
  readonly setEnabled: (pluginId: string, tgId: TgId, enabled: boolean) => Effect.Effect<void, StorageError>
}
