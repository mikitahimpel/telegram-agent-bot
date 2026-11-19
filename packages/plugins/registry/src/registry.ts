import { Effect, Layer } from "effect"
import type { CallbackDef, CommandDef } from "@bot/core-contracts/commands"
import type { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import type { AgentTool, BotPlugin } from "@bot/core-contracts/plugin"
import type { Telegram } from "@bot/core-contracts/telegram"
import { makePluginAdmin, PluginFlags } from "./flags.ts"

// oxlint-disable-next-line typescript/no-explicit-any
type AnyPlugin = BotPlugin<any, any, any> | BotPlugin<never, never, never>
// oxlint-disable-next-line typescript/no-explicit-any
type RequirementsOf<P> = P extends BotPlugin<infer R, any, any> ? R : never
// oxlint-disable-next-line typescript/no-explicit-any
type LayerErrorOf<P> = P extends BotPlugin<any, infer E, any> ? E : never
// oxlint-disable-next-line typescript/no-explicit-any
type LayerInputOf<P> = P extends BotPlugin<any, any, infer R> ? R : never

export type PluginRegistry<R> = {
  readonly plugins: ReadonlyArray<AnyPlugin>
  readonly commands: ReadonlyArray<CommandDef<R | Telegram | PluginFlags>>
  readonly callbacks: ReadonlyArray<CallbackDef<R | Telegram | PluginFlags>>
  readonly toolsFor: (tgId: TgId) => Effect.Effect<ReadonlyArray<AgentTool<R>>, StorageError, PluginFlags>
  readonly systemPromptFor: (tgId: TgId) => Effect.Effect<string, StorageError, PluginFlags>
}

export const makePluginRegistry = <const Ps extends ReadonlyArray<AnyPlugin>>(
  plugins: Ps
): PluginRegistry<RequirementsOf<Ps[number]>> & {
  readonly layer: Layer.Layer<RequirementsOf<Ps[number]>, LayerErrorOf<Ps[number]>, LayerInputOf<Ps[number]>>
} => {
  const admin = makePluginAdmin(plugins)

  const enabled = (tgId: TgId) =>
    Effect.gen(function*() {
      const flags = yield* PluginFlags
      const result: Array<AnyPlugin> = []
      for (const p of plugins) {
        if (yield* flags.isEnabled(p.id, tgId)) result.push(p)
      }
      return result
    })

  const layers = plugins.map((p) => p.layer as unknown as Layer.Layer<never, never, never>)
  const [first, ...rest] = layers
  const layer: Layer.Layer<never, never, never> = first === undefined ? Layer.empty : Layer.mergeAll(first, ...rest)

  // oxlint-disable-next-line typescript/no-explicit-any
  const registry: PluginRegistry<any> & { readonly layer: Layer.Layer<any, any, any> } = {
    plugins,
    commands: [...plugins.flatMap((p) => p.commands), ...admin.commands],
    callbacks: [...plugins.flatMap((p) => p.callbacks), ...admin.callbacks],
    toolsFor: (tgId) => enabled(tgId).pipe(Effect.map((ps) => ps.flatMap((p) => p.tools))),
    systemPromptFor: (tgId) =>
      enabled(tgId).pipe(
        Effect.map((ps) =>
          ps
            .map((p) => p.systemPrompt)
            .filter((s): s is string => s !== undefined && s !== "")
            .join("\n\n")
        )
      ),
    // oxlint-disable-next-line typescript/no-explicit-any
    layer: layer as unknown as Layer.Layer<any, any, any>
  }
  return registry as never
}
