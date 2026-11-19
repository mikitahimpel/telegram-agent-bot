import { Context, type Effect } from "effect"
import type { StorageError } from "./errors.ts"
import type { Role, TgId } from "./ids.ts"

export type AllowlistEntry = {
  readonly tgId: TgId
  readonly addedAt: number
  readonly addedBy: TgId
  readonly name?: string
  readonly username?: string
  readonly invitedVia?: string
}

export type AllowlistProfile = {
  readonly name?: string
  readonly username?: string
}

export type AllowMeta = {
  readonly invitedVia?: string
} & AllowlistProfile

export class Allowlist extends Context.Service<
  Allowlist,
  {
    readonly roleOf: (tgId: TgId) => Effect.Effect<Role | undefined, StorageError>
    readonly allow: (tgId: TgId, by: TgId, meta?: AllowMeta) => Effect.Effect<void, StorageError>
    readonly updateProfile: (tgId: TgId, profile: AllowlistProfile) => Effect.Effect<void, StorageError>
    readonly revoke: (tgId: TgId) => Effect.Effect<void, StorageError>
    readonly list: Effect.Effect<ReadonlyArray<AllowlistEntry>, StorageError>
    readonly adminId: TgId
  }
>()("@bot/Allowlist") {}
