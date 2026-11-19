import type { Effect } from "effect"
import { carPlugin } from "@bot/plugins-car/car"
import { makePluginRegistry } from "@bot/plugins-registry/registry"

/** The single place where plugins are registered. */
export const pluginRegistry = makePluginRegistry([carPlugin])

/** Services needed by plugin commands (including the admin `/plugins` command). */
export type PluginR = ReturnType<(typeof pluginRegistry)["commands"][number]["handler"]> extends Effect.Effect<
  any,
  any,
  infer R
>
  ? R
  : never
