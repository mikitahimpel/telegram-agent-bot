import { Effect, Layer } from "effect"
import { HelpRegistry } from "@bot/bot-core-commands/help-registry"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { pluginRegistry } from "./plugins.ts"
import { registry } from "./registry.ts"

export const helpRegistryLayer: Layer.Layer<HelpRegistry, never, PluginFlags> = Layer.effect(
  HelpRegistry,
  Effect.gen(function* () {
    const flags = yield* PluginFlags
    return {
      ...registry,
      pluginEnabled: (pluginId, tgId) =>
        flags.isEnabled(pluginId, tgId).pipe(Effect.catch(() => Effect.succeed(false))),
      blurbsFor: (tgId, lang) =>
        Effect.gen(function* () {
          const lines: Array<string> = []
          for (const plugin of pluginRegistry.plugins) {
            if (plugin.blurb === undefined) continue
            if (yield* flags.isEnabled(plugin.id, tgId)) lines.push(plugin.blurb[lang])
          }
          return lines
        }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)))
    }
  })
)
