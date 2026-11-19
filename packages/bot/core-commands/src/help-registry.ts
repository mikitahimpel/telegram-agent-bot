import { Context, type Effect } from "effect"
import type { HelpSource } from "@bot/bot-commands/registry"
import type { TgId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"

export type HelpRegistryShape = HelpSource & {
  readonly blurbsFor: (tgId: TgId, lang: Lang) => Effect.Effect<ReadonlyArray<string>>
}

export class HelpRegistry extends Context.Service<HelpRegistry, HelpRegistryShape>()("@bot/HelpRegistry") {}
