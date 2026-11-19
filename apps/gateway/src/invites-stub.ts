import { Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"
import { InviteInvalid, Invites, type Invite, type RedemptionRecord } from "@bot/core-contracts/invites"
import type { Env } from "./env.ts"
import type { InviteDto, RedemptionDto } from "./user-agent.ts"

const toInvite = (dto: InviteDto): Invite => ({ ...dto, createdBy: TgId.make(dto.createdBy), note: dto.note ?? undefined })

const toRedemption = (dto: RedemptionDto): RedemptionRecord => ({
  ...dto,
  tgId: TgId.make(dto.tgId),
  name: dto.name ?? undefined,
  username: dto.username ?? undefined,
  note: dto.note ?? undefined
})

export const invitesStubLayer = (env: Env): Layer.Layer<Invites> => {
  const stub = () => env.USER_AGENT.getByName(String(env.ADMIN_TG_ID))
  const call = <A>(operation: string, f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

  return Layer.succeed(Invites, {
    create: (input) =>
      call("invites.create", () => stub().createInvite({ ...input, note: input.note ?? null, plugins: [...input.plugins] })).pipe(
        Effect.map(toInvite)
      ),
    list: call("invites.list", () => stub().listInvites()).pipe(Effect.map((xs) => xs.map(toInvite))),
    recentRedemptions: (limit) =>
      call("invites.redemptions", () => stub().recentRedemptions(limit)).pipe(Effect.map((xs) => xs.map(toRedemption))),
    revoke: (code) => call("invites.revoke", () => stub().revokeInvite(code)),
    redeem: (code, tgId, who) =>
      call("invites.redeem", () =>
        stub().redeemInvite(code, tgId, { name: who?.name ?? null, username: who?.username ?? null })
      ).pipe(
        Effect.flatMap((result) =>
          result.value !== null
            ? Effect.succeed({
                ...result.value,
                createdBy: TgId.make(result.value.createdBy),
                note: result.value.note ?? undefined
              })
            : Effect.fail(new InviteInvalid({ reason: result.reason ?? "not_found" }))
        )
      )
  })
}
