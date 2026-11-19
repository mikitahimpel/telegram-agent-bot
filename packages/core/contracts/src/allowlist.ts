import { Context, type Effect } from "effect"
import type { StorageError } from "./errors.ts"
import type { Role, TgId } from "./ids.ts"

export interface AllowlistEntry {
  readonly tgId: TgId
  readonly addedAt: number
  readonly addedBy: TgId
}

/** Who may talk to the bot. Admin comes from Config `ADMIN_TG_ID`; others live in KV. */
export class Allowlist extends Context.Service<
  Allowlist,
  {
    /** `undefined` = unknown user (ignore silently). */
    readonly roleOf: (tgId: TgId) => Effect.Effect<Role | undefined, StorageError>
    readonly allow: (tgId: TgId, by: TgId) => Effect.Effect<void, StorageError>
    readonly revoke: (tgId: TgId) => Effect.Effect<void, StorageError>
    readonly list: Effect.Effect<ReadonlyArray<AllowlistEntry>, StorageError>
    readonly adminId: TgId
  }
>()("@bot/Allowlist") {}
