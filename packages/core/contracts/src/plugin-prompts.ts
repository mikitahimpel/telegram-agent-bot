import { Context, type Effect } from "effect"
import type { TgId } from "./ids.ts"
import type { Lang } from "./lang.ts"

export class PluginPrompts extends Context.Service<
  PluginPrompts,
  { readonly forUser: (tgId: TgId, lang: Lang) => Effect.Effect<string> }
>()("@bot/PluginPrompts") {}
