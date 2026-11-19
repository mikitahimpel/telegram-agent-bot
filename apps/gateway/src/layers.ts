import { Layer } from "effect"
import { UserMemory } from "@bot/bot-memory/user-memory"
import { UserScheduler } from "@bot/bot-scheduler/user-scheduler"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import type { CarBackend } from "@bot/car-store/backend"
import { CarKv } from "@bot/plugins-car/kv"
import { CarBucket, type R2Like as CarR2Like } from "@bot/plugins-car/r2"
import { PluginFlags, layerKv } from "@bot/plugins-registry/flags"
import { layerKv as reminderSettingsLayer } from "@bot/plugins-reminders/settings"
import { layer as mcpTokenLayer } from "@bot/plugins-registry/mcp-token"
import { layerFetch as telegramLayer } from "@bot/telegram-client/client"
import { configLayer } from "./config.ts"
import type { Env } from "./env.ts"
import { pluginRegistry } from "./plugins.ts"
import { rpcCarBackend } from "./car-backend.ts"
import { rpcUserMemory } from "./memory-rpc.ts"
import { rpcUserScheduler } from "./scheduler-rpc.ts"
import { rpcUserPrefs } from "./user-prefs.ts"

export const pluginEnvironment = (
  env: Env,
  origin?: string,
  scheduler: Layer.Layer<UserScheduler> = rpcUserScheduler(env),
  memory: Layer.Layer<UserMemory> = rpcUserMemory(env),
  prefs: Layer.Layer<UserPrefs> = rpcUserPrefs(env),
  carBackend: Layer.Layer<CarBackend> = rpcCarBackend(env)
) => {
  const base = Layer.mergeAll(
    telegramLayer,
    layerKv(env.KV, pluginRegistry.plugins),
    Layer.succeed(CarBucket, env.BACKUPS as unknown as CarR2Like),
    Layer.succeed(CarKv, env.KV),
    mcpTokenLayer,
    reminderSettingsLayer(env.KV),
    scheduler,
    memory,
    prefs,
    carBackend
  )
  return pluginRegistry.layer.pipe(Layer.provideMerge(base), Layer.provide(configLayer(env, origin)))
}

export { PluginFlags }
