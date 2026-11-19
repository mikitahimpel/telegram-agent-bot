import { defineMessages, type Lang } from "@bot/core-contracts/lang"
import type { Role } from "@bot/core-contracts/ids"
import { escapeHtml } from "./html.ts"
import type { HelpSource } from "./registry.ts"

const helpMessages = defineMessages({
  en: {
    adminBanner: "You are the <b>admin</b> of this bot.",
    userHeader: "Commands",
    adminHeader: "Admin commands"
  },
  ru: {
    adminBanner: "Вы <b>администратор</b> этого бота.",
    userHeader: "Команды",
    adminHeader: "Команды администратора"
  }
})

export const renderHelp = (registry: HelpSource, role: Role, lang: Lang): string => {
  const m = helpMessages[lang]
  const visible = registry.visibleFor(role)
  const line = (c: (typeof visible)[number]) => {
    const usage = c.usage?.[lang]
    const head = usage === undefined || usage === "" ? `/${c.name}` : `/${c.name} ${usage}`
    return `<code>${escapeHtml(head)}</code> — ${escapeHtml(c.description[lang])}`
  }
  const group = (title: string, r: Role) => {
    const lines = visible.filter((c) => c.role === r).map(line)
    return lines.length === 0 ? [] : [`<b>${title}</b>\n${lines.join("\n")}`]
  }
  const blocks = [
    ...(role === "admin" ? [m.adminBanner] : []),
    ...group(m.userHeader, "user"),
    ...(role === "admin" ? group(m.adminHeader, "admin") : [])
  ]
  return blocks.join("\n\n")
}
