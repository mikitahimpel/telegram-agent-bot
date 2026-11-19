import type { CallbackDef, CommandDef } from "@bot/core-contracts/commands"
import type { ChatId, Role } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import type { BotCommandEntry, CommandScope } from "@bot/core-contracts/telegram"

export interface HelpSource {
  readonly visibleFor: (role: Role) => ReadonlyArray<Pick<CommandDef, "name" | "role" | "description" | "usage">>
}

export interface MenuPayload {
  readonly scope: CommandScope
  readonly languageCode: string | undefined
  readonly commands: ReadonlyArray<BotCommandEntry>
}

export interface Registry<R = never> extends HelpSource {
  readonly find: (name: string, role: Role) => CommandDef<R> | undefined
  readonly findCallback: (
    data: string,
    role: Role
  ) => { readonly def: CallbackDef<R>; readonly payload: string } | undefined
  readonly visibleFor: (role: Role) => ReadonlyArray<CommandDef<R>>
  readonly menus: (adminChatId: ChatId) => ReadonlyArray<MenuPayload>
}

const MENU_LANGS: ReadonlyArray<{ readonly lang: Lang; readonly languageCode: string | undefined }> = [
  { lang: "en", languageCode: undefined },
  { lang: "ru", languageCode: "ru" }
]

const MIN_DESCRIPTION = 3
const MAX_DESCRIPTION = 256

export const clampDescription = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed.length > MAX_DESCRIPTION) return `${trimmed.slice(0, MAX_DESCRIPTION - 1)}…`
  return trimmed.length < MIN_DESCRIPTION ? trimmed.padEnd(MIN_DESCRIPTION, ".") : trimmed
}

const normalizeName = (name: string): string => {
  const bare = name.startsWith("/") ? name.slice(1) : name
  const at = bare.indexOf("@")
  return (at === -1 ? bare : bare.slice(0, at)).toLowerCase()
}

const allowed = (required: Role, role: Role): boolean => role === "admin" || required === "user"

export const makeRegistry = <R>(
  commands: ReadonlyArray<CommandDef<R>>,
  callbacks: ReadonlyArray<CallbackDef<R>>
): Registry<R> => {
  const byName = new Map<string, CommandDef<R>>()
  for (const c of commands) {
    if (byName.has(c.name)) throw new Error(`duplicate command: ${c.name}`)
    byName.set(c.name, c)
  }
  const byPrefix = new Map<string, CallbackDef<R>>()
  for (const c of callbacks) {
    if (byPrefix.has(c.prefix)) throw new Error(`duplicate callback prefix: ${c.prefix}`)
    byPrefix.set(c.prefix, c)
  }

  const visibleFor = (role: Role): ReadonlyArray<CommandDef<R>> => {
    const shown = commands.filter(
      (c) => c.hidden !== true && allowed(c.role, role) && (c.advanced !== true || role === "admin")
    )
    return [...shown.filter((c) => c.role === "user"), ...shown.filter((c) => c.role === "admin")]
  }

  const entries = (role: Role, lang: Lang): ReadonlyArray<BotCommandEntry> =>
    visibleFor(role).map((c) => ({ command: c.name, description: clampDescription(c.description[lang]) }))

  return {
    find: (name, role) => {
      const def = byName.get(normalizeName(name))
      return def !== undefined && allowed(def.role, role) ? def : undefined
    },
    findCallback: (data, role) => {
      const colon = data.indexOf(":")
      const prefix = colon === -1 ? data : data.slice(0, colon)
      const def = byPrefix.get(prefix)
      if (def === undefined || !allowed(def.role, role)) return undefined
      return { def, payload: colon === -1 ? "" : data.slice(colon + 1) }
    },
    visibleFor,
    menus: (adminChatId) => [
      ...MENU_LANGS.map(({ lang, languageCode }) => ({
        scope: { type: "default" } as const,
        languageCode,
        commands: entries("user", lang)
      })),
      ...MENU_LANGS.map(({ lang, languageCode }) => ({
        scope: { type: "chat", chatId: adminChatId } as const,
        languageCode,
        commands: entries("admin", lang)
      }))
    ]
  }
}
