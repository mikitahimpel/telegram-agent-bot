import type { Effect } from "effect"
import { carPlugin } from "@bot/plugins-car/car"
import { makePluginRegistry } from "@bot/plugins-registry/registry"

export const pluginRegistry = makePluginRegistry([carPlugin])

export type PluginR = ReturnType<(typeof pluginRegistry)["commands"][number]["handler"]> extends Effect.Effect<
  any,
  any,
  infer R
>
  ? R
  : never
