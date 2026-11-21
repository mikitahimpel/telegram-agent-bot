import { Effect, Layer } from "effect"
import { PluginPrompts } from "@bot/core-contracts/plugin-prompts"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { pluginRegistry } from "./plugins.ts"

export const pluginPromptsLayer: Layer.Layer<PluginPrompts, never, PluginFlags> = Layer.effect(
  PluginPrompts,
  Effect.gen(function* () {
    const flags = yield* PluginFlags
    return PluginPrompts.of({
      forUser: (tgId, lang) =>
        Effect.gen(function* () {
          const abilities: Array<string> = []
          const guides: Array<string> = []
          for (const plugin of pluginRegistry.plugins) {
            if (!(yield* flags.isEnabled(plugin.id, tgId))) continue
            if (plugin.blurb !== undefined) abilities.push(`- ${plugin.blurb[lang]}`)
            if (plugin.systemPrompt !== undefined && plugin.systemPrompt !== "") guides.push(plugin.systemPrompt)
          }
          const parts: Array<string> = []
          if (abilities.length > 0) {
            parts.push(
              `Extra abilities enabled for this user (mention them naturally when relevant or when asked what you can do):\n${abilities.join("\n")}`
            )
          }
          parts.push(...guides)
          return parts.join("\n\n")
        }).pipe(Effect.catch(() => Effect.succeed("")))
    })
  })
)
