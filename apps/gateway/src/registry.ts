import { makeRegistry } from "@bot/bot-commands/registry"
import { coreCallbacks, coreCommands, type CoreR } from "@bot/bot-core-commands/core-commands"
import { pluginRegistry, type PluginR } from "./plugins.ts"

/** One registry for the whole bot: core commands plus plugin commands. Also feeds the Telegram menus at deploy time. */
export const registry = makeRegistry<CoreR | PluginR>(
  [...coreCommands, ...pluginRegistry.commands],
  [...coreCallbacks, ...pluginRegistry.callbacks]
)
