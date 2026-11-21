import { Context, type Effect } from "effect"
import type { TgId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"

export class McpAccess extends Context.Service<
  McpAccess,
  {
    readonly issue: (
      tgId: TgId,
      lang?: Lang
    ) => Effect.Effect<{ readonly url: string; readonly token: string } | undefined>
  }
>()("@bot/McpAccess") {}
