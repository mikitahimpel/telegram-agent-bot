import { Context, Data, type Effect } from "effect"
import type { StorageError } from "./errors.ts"
import type { TgId } from "./ids.ts"

export interface Invite {
  readonly code: string
  readonly createdBy: TgId
  readonly note: string | undefined
  readonly plugins: ReadonlyArray<string>
  readonly usesTotal: number
  readonly usesLeft: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly revoked: boolean
}

export interface CreateInviteInput {
  readonly createdBy: TgId
  readonly uses: number
  readonly ttlMs: number
  readonly plugins: ReadonlyArray<string>
  readonly note: string | undefined
}

export interface Redeemer {
  readonly name?: string
  readonly username?: string
}

export interface InviteRedeemed {
  readonly code: string
  readonly createdBy: TgId
  readonly note: string | undefined
  readonly plugins: ReadonlyArray<string>
  readonly redeemedAt: number
}

export interface RedemptionRecord {
  readonly code: string
  readonly tgId: TgId
  readonly name: string | undefined
  readonly username: string | undefined
  readonly note: string | undefined
  readonly at: number
}

export type InviteInvalidReason = "not_found" | "expired" | "used_up" | "revoked" | "rate_limited"

export class InviteInvalid extends Data.TaggedError("InviteInvalid")<{
  readonly reason: InviteInvalidReason
}> {}

export class Invites extends Context.Service<
  Invites,
  {
    readonly create: (input: CreateInviteInput) => Effect.Effect<Invite, StorageError>
    readonly list: Effect.Effect<ReadonlyArray<Invite>, StorageError>
    readonly recentRedemptions: (limit: number) => Effect.Effect<ReadonlyArray<RedemptionRecord>, StorageError>
    readonly revoke: (code: string) => Effect.Effect<boolean, StorageError>
    readonly redeem: (
      code: string,
      tgId: TgId,
      who?: Redeemer
    ) => Effect.Effect<InviteRedeemed, InviteInvalid | StorageError>
  }
>()("@bot/Invites") {}
