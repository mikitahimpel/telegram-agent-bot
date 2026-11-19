import { makeRegistry } from "@bot/bot-commands/registry"
import { coreCallbacks, coreCommands, type CoreR } from "@bot/bot-core-commands/core-commands"
import { makeInviteCommands, type InviteR } from "@bot/bot-invites/commands"
import { pluginRegistry, type PluginR } from "./plugins.ts"

/** One registry for the whole bot: core commands plus plugin commands. Also feeds the Telegram menus at deploy time. */
const invites = makeInviteCommands(pluginRegistry.plugins.map((p) => p.id))

export const registry = makeRegistry<CoreR | PluginR | InviteR>(
  [...coreCommands, ...invites.commands, ...pluginRegistry.commands],
  [...coreCallbacks, ...invites.callbacks, ...pluginRegistry.callbacks]
)
