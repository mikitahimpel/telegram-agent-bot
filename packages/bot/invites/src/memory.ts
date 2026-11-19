import { Effect, Layer } from "effect"
import { InviteInvalid, Invites, type Invite, type InviteInvalidReason, type RedemptionRecord } from "@bot/core-contracts/invites"
import { FAILURE_LIMIT, FAILURE_WINDOW_MS, generateCode } from "./sqlite.ts"

export const makeMemory = (now: () => number = Date.now): Invites["Service"] => {
  const invites = new Map<string, Invite>()
  const redemptions: Array<RedemptionRecord> = []
  const failures: Array<{ readonly tgId: number; readonly at: number }> = []

  const reasonOf = (invite: Invite | undefined, at: number): InviteInvalidReason =>
    invite === undefined ? "not_found" : invite.revoked ? "revoked" : invite.expiresAt <= at ? "expired" : "used_up"

  return {
    create: (input) =>
      Effect.sync(() => {
        const at = now()
        const invite: Invite = {
          code: generateCode(),
          createdBy: input.createdBy,
          note: input.note,
          plugins: input.plugins,
          usesTotal: input.uses,
          usesLeft: input.uses,
          createdAt: at,
          expiresAt: at + input.ttlMs,
          revoked: false
        }
        invites.set(invite.code, invite)
        return invite
      }),
    list: Effect.sync(() =>
      [...invites.values()]
        .filter((i) => !i.revoked && i.usesLeft > 0 && i.expiresAt > now())
        .sort((a, b) => b.createdAt - a.createdAt)
    ),
    recentRedemptions: (limit) => Effect.sync(() => [...redemptions].reverse().slice(0, limit)),
    revoke: (code) =>
      Effect.sync(() => {
        const invite = invites.get(code)
        if (invite === undefined || invite.revoked) return false
        invites.set(code, { ...invite, revoked: true })
        return true
      }),
    redeem: (code, tgId, who) =>
      Effect.suspend(() => {
        const at = now()
        if (failures.filter((f) => f.tgId === tgId && f.at > at - FAILURE_WINDOW_MS).length >= FAILURE_LIMIT) {
          return Effect.fail(new InviteInvalid({ reason: "rate_limited" }))
        }
        const invite = invites.get(code)
        if (invite === undefined || invite.revoked || invite.usesLeft <= 0 || invite.expiresAt <= at) {
          failures.push({ tgId, at })
          return Effect.fail(new InviteInvalid({ reason: reasonOf(invite, at) }))
        }
        invites.set(code, { ...invite, usesLeft: invite.usesLeft - 1 })
        redemptions.push({ code, tgId, name: who?.name, username: who?.username, note: invite.note, at })
        return Effect.succeed({
          code,
          createdBy: invite.createdBy,
          note: invite.note,
          plugins: invite.plugins,
          redeemedAt: at
        })
      })
  }
}

export const layer = (now?: () => number) => Layer.sync(Invites, () => makeMemory(now))
