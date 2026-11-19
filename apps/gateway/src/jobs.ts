import { Effect } from "effect"
import type { TgId } from "@bot/core-contracts/ids"
import type { JobHandler } from "@bot/core-contracts/scheduler"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { dispatcherJobs, type DispatchR } from "./dispatch.ts"
import { pluginRegistry } from "./plugins.ts"

export type JobR = DispatchR

export const coreJobHandlers: ReadonlyArray<JobHandler<JobR>> = [...dispatcherJobs]

export const enabledJobHandlers = (tgId: TgId) =>
  Effect.gen(function* () {
    const flags = yield* PluginFlags
    const handlers: Array<JobHandler<JobR>> = [...coreJobHandlers]
    for (const plugin of pluginRegistry.plugins) {
      if (plugin.jobs !== undefined && (yield* flags.isEnabled(plugin.id, tgId))) {
        handlers.push(...(plugin.jobs as ReadonlyArray<JobHandler<JobR>>))
      }
    }
    return handlers
  })
