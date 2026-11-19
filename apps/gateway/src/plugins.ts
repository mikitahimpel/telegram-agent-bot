import type { Effect } from "effect"
import { carPlugin } from "@bot/plugins-car/car"
import { memoryPlugin } from "@bot/plugins-memory/memory"
import { remindersPlugin } from "@bot/plugins-reminders/reminders"
import { makePluginRegistry } from "@bot/plugins-registry/registry"

export const pluginRegistry = makePluginRegistry([carPlugin, remindersPlugin, memoryPlugin])

export type PluginR = ReturnType<(typeof pluginRegistry)["commands"][number]["handler"]> extends Effect.Effect<
  any,
  any,
  infer R
>
  ? R
  : never
