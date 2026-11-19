import { Context, type Effect } from "effect"
import type { TgId } from "@bot/core-contracts/ids"

/** MCP endpoint + short-lived token for the agent; `undefined` when no plugin tools are enabled for the account. */
export class McpAccess extends Context.Service<
  McpAccess,
  { readonly issue: (tgId: TgId) => Effect.Effect<{ readonly url: string; readonly token: string } | undefined> }
>()("@bot/McpAccess") {}
