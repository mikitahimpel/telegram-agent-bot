import { Context, type Effect } from "effect"
import type { StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"
import type { Lang } from "./lang.ts"

export class UserPrefs extends Context.Service<
  UserPrefs,
  {
    readonly timeZone: (tgId: TgId) => Effect.Effect<string | undefined, StorageError>
    readonly lang: (tgId: TgId) => Effect.Effect<Lang | undefined, StorageError>
  }
>()("@bot/UserPrefs") {}
