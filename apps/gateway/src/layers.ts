import { Layer } from "effect"
import { CarBucket, type R2Like as CarR2Like } from "@bot/plugins-car/r2"
import { PluginFlags, layerKv } from "@bot/plugins-registry/flags"
import { layer as mcpTokenLayer } from "@bot/plugins-registry/mcp-token"
import { layerFetch as telegramLayer } from "@bot/telegram-client/client"
import { configLayer } from "./config.ts"
import type { Env } from "./env.ts"
import { pluginRegistry } from "./plugins.ts"

/**
 * Everything plugin tools and plugin commands need: Telegram, flags, the car bucket and the
 * plugin layers themselves. Shared by the user-agent DO and the Worker's /mcp route.
 */
export const pluginEnvironment = (env: Env) => {
  const base = Layer.mergeAll(
    telegramLayer,
    layerKv(env.KV, pluginRegistry.plugins),
    Layer.succeed(CarBucket, env.BACKUPS as unknown as CarR2Like),
    mcpTokenLayer
  )
  return pluginRegistry.layer.pipe(Layer.provideMerge(base), Layer.provide(configLayer(env)))
}

export { PluginFlags }
