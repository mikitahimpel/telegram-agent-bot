import { Effect } from "effect"
import { escapeHtml } from "@bot/bot-commands/html"
import { newTopicKeyboard } from "@bot/bot-commands/messages"
import { HelpRegistry } from "@bot/bot-core-commands/help-registry"
import { renderWelcome } from "@bot/bot-core-commands/welcome"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { ChatId, TgId } from "@bot/core-contracts/ids"
import { Invites, type InviteInvalidReason } from "@bot/core-contracts/invites"
import { langFromTelegram, type Lang } from "@bot/core-contracts/lang"
import { Telegram } from "@bot/core-contracts/telegram"
import { PluginFlags } from "@bot/plugins-registry/flags"
import type { User } from "@bot/telegram-schema/schema"
import { messages } from "./messages.ts"

export type RedeemR = Telegram | Allowlist | Invites | PluginFlags | HelpRegistry

const failureText = (reason: InviteInvalidReason, lang: Lang): string | undefined => {
  const m = messages[lang]
  switch (reason) {
    case "not_found":
      return m.reasonNotFound
    case "expired":
      return m.reasonExpired
    case "used_up":
      return m.reasonUsedUp
    case "revoked":
      return m.reasonRevoked
    case "rate_limited":
      return undefined
  }
}

export interface RedeemInput {
  readonly from: User
  readonly code: string
  readonly adminLang: Lang
}

export const redeemInviteStart = ({ from, code, adminLang }: RedeemInput) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    const allowlist = yield* Allowlist
    const invites = yield* Invites
    const flags = yield* PluginFlags
    const help = yield* HelpRegistry
    const lang = langFromTelegram(from.language_code)
    const m = messages[lang]
    const tgId = TgId.make(from.id)
    const to = { chatId: ChatId.make(from.id) }

    const role = yield* allowlist.roleOf(tgId)
    if (role === "admin") return yield* tg.sendMessage(to, m.adminOwnInvite)
    if (role === "user") return yield* tg.sendMessage(to, m.alreadyHaveAccess)

    const who = { name: from.first_name, ...(from.username === undefined ? {} : { username: from.username }) }
    const result = yield* invites.redeem(code, tgId, who).pipe(Effect.result)
    if (result._tag === "Failure") {
      const failure = result.failure
      if (failure._tag === "InviteInvalid") {
        const text = failureText(failure.reason, lang)
        if (text !== undefined) yield* tg.sendMessage(to, text)
        return
      }
      return yield* Effect.fail(failure)
    }
    const redeemed = result.success

    yield* allowlist.allow(tgId, redeemed.createdBy, { ...who, invitedVia: redeemed.code })
    for (const pluginId of redeemed.plugins) yield* flags.setEnabled(pluginId, tgId, true)

    const blurbs = yield* help.blurbsFor(tgId, lang)
    yield* tg.sendMessage(to, renderWelcome(from.first_name, lang, blurbs, false), {
      replyKeyboard: newTopicKeyboard(lang)
    })

    const am = messages[adminLang]
    const display = `${escapeHtml(from.first_name)} (${from.username === undefined ? "" : `@${escapeHtml(from.username)}, `}<code>${from.id}</code>)`
    yield* tg
      .sendMessage({ chatId: ChatId.make(allowlist.adminId) }, am.joined(display, redeemed.note), {
        keyboard: [[{ text: am.btnRevokeAccess, callbackData: `revask:${from.id}`, style: "danger" }]]
      })
      .pipe(Effect.ignore)
  })
