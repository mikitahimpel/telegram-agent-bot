import { Effect } from "effect"
import { make as makeAllowlist } from "@bot/bot-allowlist/allowlist"
import { TgId } from "@bot/core-contracts/ids"
import { inviteCodeFromMessage } from "@bot/bot-invites/parse"
import { decodeUpdate, type Update, type User } from "@bot/telegram-schema/schema"
import type { Env } from "./env.ts"

export const SECRET_HEADER = "x-telegram-bot-api-secret-token"

const encoder = new TextEncoder()

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))

/** Compares digests of both values, so neither the length nor the content leaks through timing. */
export const secretMatches = async (given: string | null, expected: string): Promise<boolean> => {
  const [a, b] = await Promise.all([sha256(given ?? ""), sha256(expected)])
  let diff = given === null || expected === "" ? 1 : 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** The Telegram user whose agent should handle the update (chat id equals user id in private chats). */
export const senderOf = (update: Update): number | undefined =>
  update.message?.from?.id ?? update.callback_query?.from.id ?? update.stopped_message_generation?.chat.id

export type WebhookOutcome =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "Ignored"; readonly reason: string }
  | { readonly _tag: "Invite"; readonly from: User; readonly code: string }
  | { readonly _tag: "Forward"; readonly tgId: number; readonly raw: unknown }

/** Secret check, decoding and the early allowlist check. The DO re-checks the role itself. */
export const screenWebhook = (request: Request, env: Env): Effect.Effect<WebhookOutcome> =>
  Effect.gen(function* () {
    const ok = yield* Effect.promise(() => secretMatches(request.headers.get(SECRET_HEADER), env.TELEGRAM_WEBHOOK_SECRET))
    if (!ok) return { _tag: "Forbidden" } as const
    const raw = yield* Effect.promise(() => request.json()).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    if (raw === undefined) return { _tag: "Ignored", reason: "invalid json" } as const
    const decoded = yield* decodeUpdate(raw).pipe(Effect.result)
    if (decoded._tag === "Failure") return { _tag: "Ignored", reason: "undecodable update" } as const
    const tgId = senderOf(decoded.success)
    if (tgId === undefined) return { _tag: "Ignored", reason: "no sender" } as const
    const inviteCode = decoded.success.message === undefined ? undefined : inviteCodeFromMessage(decoded.success.message)
    if (inviteCode !== undefined && decoded.success.message?.from !== undefined) {
      return { _tag: "Invite", from: decoded.success.message.from, code: inviteCode } as const
    }
    const allowlist = makeAllowlist(env.KV, TgId.make(Number(env.ADMIN_TG_ID)))
    const role = yield* allowlist.roleOf(TgId.make(tgId)).pipe(Effect.catchCause(() => Effect.succeed("user" as const)))
    if (role === undefined) return { _tag: "Ignored", reason: "unknown user" } as const
    return { _tag: "Forward", tgId, raw } as const
  }).pipe(Effect.withSpan("gateway.webhook"))
