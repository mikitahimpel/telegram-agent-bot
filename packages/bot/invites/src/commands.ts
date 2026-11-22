import { Effect } from "effect"
import { formatDateTime } from "@bot/bot-commands/messages"
import type { CallbackDef, CommandContext, CommandDef } from "@bot/core-contracts/commands"
import { Invites, type Invite } from "@bot/core-contracts/invites"
import { Telegram, type InlineKeyboard, type SendTarget } from "@bot/core-contracts/telegram"
import { messages } from "./messages.ts"
import { parseInviteArgs } from "./parse.ts"

export type InviteR = Telegram | Invites

export const CALLBACK_PREFIX = "invrev"
const MAX_LISTED = 20
const REDEMPTIONS_SHOWN = 10

const usernameCache = new WeakMap<object, string>()

const botUsername = (tg: Telegram["Service"]) =>
  Effect.gen(function* () {
    const cached = usernameCache.get(tg)
    if (cached !== undefined) return cached
    const result = yield* tg.call("getMe", {}).pipe(Effect.option)
    const value =
      result._tag === "Some" ? (result.value as { readonly username?: unknown } | null)?.username : undefined
    if (typeof value !== "string" || value === "") return undefined
    usernameCache.set(tg, value)
    return value
  })

export const inviteLink = (username: string, code: string) => `https://t.me/${username}?start=inv_${code}`

const target = (ctx: {
  readonly chatId: SendTarget["chatId"]
  readonly threadId: SendTarget["threadId"] | undefined
}): SendTarget => (ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId })

const reply = (ctx: CommandContext, html: string, keyboard?: InlineKeyboard) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    yield* tg.sendMessage(target(ctx), html, keyboard === undefined ? undefined : { keyboard })
  })

const revokeButton = (text: string, code: string) => ({
  text,
  callbackData: `${CALLBACK_PREFIX}:${code}`,
  style: "danger" as const
})

const label = (invite: Invite) => invite.note ?? invite.code.slice(0, 6)

const redeemerLabel = (r: {
  readonly name: string | undefined
  readonly username: string | undefined
  readonly tgId: number
}) => `${r.name ?? String(r.tgId)}${r.username === undefined ? "" : ` (@${r.username})`}`

export const makeInviteCommands = (
  knownPlugins: ReadonlyArray<string>
): {
  readonly commands: ReadonlyArray<CommandDef<InviteR>>
  readonly callbacks: ReadonlyArray<CallbackDef<InviteR>>
} => {
  const invite: CommandDef<InviteR> = {
    name: "invite",
    role: "admin",
    description: {
      en: "Create an invite link for a new user",
      ru: "Создать ссылку-приглашение для нового пользователя"
    },
    usage: { en: '[uses=N] [ttl=7d] [plugins=car] ["note"]', ru: '[uses=N] [ttl=7d] [plugins=car] ["заметка"]' },
    handler: (ctx) =>
      Effect.gen(function* () {
        const tg = yield* Telegram
        const invites = yield* Invites
        const m = messages[ctx.lang]
        const parsed = parseInviteArgs(ctx.args, knownPlugins)
        if (!parsed.ok) {
          const { error } = parsed
          const text =
            error.kind === "uses"
              ? m.badUses(error.value)
              : error.kind === "ttl"
                ? m.badTtl(error.value)
                : m.badPlugin(error.value, knownPlugins.join(", "))
          return yield* reply(ctx, `${text}\n\n${m.inviteUsage}`)
        }
        const username = yield* botUsername(tg)
        if (username === undefined) return yield* reply(ctx, m.botUnavailable)
        const { options } = parsed
        const created = yield* invites.create({
          createdBy: ctx.tgId,
          uses: options.uses,
          ttlMs: options.ttlMs,
          plugins: options.plugins,
          note: options.note
        })
        const link = inviteLink(username, created.code)
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(m.shareText)}`
        yield* reply(
          ctx,
          m.created(
            link,
            created.usesTotal,
            formatDateTime(created.expiresAt, ctx.lang),
            created.plugins.join(", "),
            created.note
          ),
          [
            [{ text: m.btnShareInvite, url: shareUrl, style: "primary" as const }],
            [revokeButton(m.btnRevokeInvite, created.code)]
          ]
        )
      })
  }

  const invitesCmd: CommandDef<InviteR> = {
    name: "invites",
    role: "admin",
    description: { en: "Active invites and recent redemptions", ru: "Активные приглашения и последние активации" },
    handler: (ctx) =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const m = messages[ctx.lang]
        const active = (yield* invites.list).slice(0, MAX_LISTED)
        const redemptions = yield* invites.recentRedemptions(REDEMPTIONS_SHOWN)
        const lines = active.map((i) =>
          m.inviteLine(
            i.note,
            i.code,
            i.usesLeft,
            i.usesTotal,
            formatDateTime(i.expiresAt, ctx.lang),
            formatDateTime(i.createdAt, ctx.lang)
          )
        )
        const redLines = redemptions.map((r) =>
          m.redemptionLine(redeemerLabel(r), r.note, formatDateTime(r.at, ctx.lang))
        )
        const text = [
          active.length === 0 ? m.invitesNone : [m.invitesHeader, ...lines].join("\n"),
          redemptions.length === 0 ? m.redemptionsNone : [m.redemptionsHeader, ...redLines].join("\n")
        ].join("\n\n")
        yield* reply(
          ctx,
          text,
          active.map((i) => [revokeButton(m.btnRevokeNamed(label(i)), i.code)])
        )
      })
  }

  const revokeCallback: CallbackDef<InviteR> = {
    prefix: CALLBACK_PREFIX,
    role: "admin",
    handler: (ctx) =>
      Effect.gen(function* () {
        const tg = yield* Telegram
        const invites = yield* Invites
        const m = messages[ctx.lang]
        if (ctx.role !== "admin" || !/^[A-Za-z0-9]{16,48}$/.test(ctx.payload)) {
          return yield* tg.answerCallbackQuery(ctx.callbackId)
        }
        const revoked = yield* invites
          .revoke(ctx.payload)
          .pipe(Effect.tapError(() => Effect.ignore(tg.answerCallbackQuery(ctx.callbackId))))
        const text = revoked ? m.inviteRevoked : m.inviteNotFound
        yield* tg.answerCallbackQuery(ctx.callbackId, text)
        if (ctx.messageId !== 0) {
          yield* tg.editMessageText({ ...target(ctx), messageId: ctx.messageId }, text).pipe(Effect.ignore)
        }
      })
  }

  return { commands: [invite, invitesCmd], callbacks: [revokeCallback] }
}
