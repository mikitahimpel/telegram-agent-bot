import { escapeHtml as e } from "@bot/bot-commands/html"
import { formatDateTime } from "@bot/bot-commands/messages"
import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
    inviteUsage:
      'Usage: <code>/invite [uses=N] [ttl=7d|24h|30m] [plugins=car,...] ["note"]</code>\nExamples: <code>/invite</code>, <code>/invite uses=3 ttl=24h</code>, <code>/invite plugins=car "Masha"</code>',
    badUses: (v: string) => `Invalid <code>uses=${e(v)}</code>: expected a number from 1 to 100.`,
    badTtl: (v: string) => `Invalid <code>ttl=${e(v)}</code>: use e.g. 30m, 24h or 7d (up to 90d).`,
    badPlugin: (v: string, known: string) =>
      `Unknown plugin <code>${e(v)}</code>. Available: ${known === "" ? "none" : e(known)}.`,
    botUnavailable: "Could not determine the bot username. Try again later.",
    created: (link: string, uses: number, expires: string, plugins: string, note: string | undefined) =>
      [
        "Invite created. Send this link:",
        e(link),
        `Uses: ${uses}, valid until ${expires}`,
        `Plugins: ${plugins === "" ? "default" : e(plugins)}`,
        ...(note === undefined ? [] : [`Note: ${e(note)}`])
      ].join("\n"),
    btnRevokeInvite: "Revoke",
    btnShareInvite: "Share",
    shareText: "Join my assistant:",
    invitesNone: "No active invites.",
    invitesHeader: "<b>Active invites</b>",
    inviteLine: (
      note: string | undefined,
      code: string,
      left: number,
      total: number,
      expires: string,
      created: string
    ) => `• <b>${e(note ?? code.slice(0, 6))}</b> — ${left}/${total} left, expires ${expires}, created ${created}`,
    redemptionsHeader: "<b>Recent redemptions</b>",
    redemptionsNone: "No redemptions yet.",
    redemptionLine: (who: string, note: string | undefined, at: string) =>
      `• ${e(who)}${note === undefined ? "" : ` «${e(note)}»`} — ${at}`,
    btnRevokeNamed: (label: string) => `Revoke ${label}`,
    inviteRevoked: "Invite revoked.",
    inviteNotFound: "Invite not found or already revoked.",
    joined: (who: string, note: string | undefined) =>
      `✅ ${who} joined via invite${note === undefined ? "" : ` «${e(note)}»`}`,
    btnRevokeAccess: "Revoke access",
    welcome: (name: string) =>
      `Welcome, ${e(name)}! You now have access. Just write me a message to start. Here is what I can do:`,
    alreadyHaveAccess: "You already have access to this bot.",
    adminOwnInvite: "This is your own invite link: you are the admin, nothing to redeem. Send it to someone else.",
    reasonNotFound: "This invite link is invalid.",
    reasonExpired: "This invite link has expired. Ask for a new one.",
    reasonUsedUp: "This invite link has already been used.",
    reasonRevoked: "This invite link was revoked."
  },
  ru: {
    inviteUsage:
      'Использование: <code>/invite [uses=N] [ttl=7d|24h|30m] [plugins=car,...] ["заметка"]</code>\nПримеры: <code>/invite</code>, <code>/invite uses=3 ttl=24h</code>, <code>/invite plugins=car "Маша"</code>',
    badUses: (v: string) => `Неверное <code>uses=${e(v)}</code>: нужно число от 1 до 100.`,
    badTtl: (v: string) => `Неверное <code>ttl=${e(v)}</code>: например 30m, 24h или 7d (до 90d).`,
    badPlugin: (v: string, known: string) =>
      `Неизвестный плагин <code>${e(v)}</code>. Доступны: ${known === "" ? "нет" : e(known)}.`,
    botUnavailable: "Не удалось определить имя бота. Попробуйте позже.",
    created: (link: string, uses: number, expires: string, plugins: string, note: string | undefined) =>
      [
        "Приглашение создано. Отправьте эту ссылку:",
        e(link),
        `Использований: ${uses}, действует до ${expires}`,
        `Плагины: ${plugins === "" ? "по умолчанию" : e(plugins)}`,
        ...(note === undefined ? [] : [`Заметка: ${e(note)}`])
      ].join("\n"),
    btnRevokeInvite: "Отозвать",
    btnShareInvite: "Поделиться",
    shareText: "Присоединяйся к моему помощнику:",
    invitesNone: "Активных приглашений нет.",
    invitesHeader: "<b>Активные приглашения</b>",
    inviteLine: (
      note: string | undefined,
      code: string,
      left: number,
      total: number,
      expires: string,
      created: string
    ) => `• <b>${e(note ?? code.slice(0, 6))}</b> — осталось ${left}/${total}, истекает ${expires}, создано ${created}`,
    redemptionsHeader: "<b>Последние активации</b>",
    redemptionsNone: "Активаций пока нет.",
    redemptionLine: (who: string, note: string | undefined, at: string) =>
      `• ${e(who)}${note === undefined ? "" : ` «${e(note)}»`} — ${at}`,
    btnRevokeNamed: (label: string) => `Отозвать ${label}`,
    inviteRevoked: "Приглашение отозвано.",
    inviteNotFound: "Приглашение не найдено или уже отозвано.",
    joined: (who: string, note: string | undefined) =>
      `✅ ${who} присоединился по приглашению${note === undefined ? "" : ` «${e(note)}»`}`,
    btnRevokeAccess: "Отозвать доступ",
    welcome: (name: string) =>
      `Добро пожаловать, ${e(name)}! Доступ открыт. Просто напишите мне сообщение. Вот что я умею:`,
    alreadyHaveAccess: "У вас уже есть доступ к этому боту.",
    adminOwnInvite:
      "Это ваша собственная ссылка-приглашение: вы администратор, активировать нечего. Отправьте её другому человеку.",
    reasonNotFound: "Эта ссылка-приглашение недействительна.",
    reasonExpired: "Срок действия этой ссылки истёк. Попросите новую.",
    reasonUsedUp: "Эта ссылка-приглашение уже использована.",
    reasonRevoked: "Эта ссылка-приглашение была отозвана."
  }
})

export { formatDateTime }
