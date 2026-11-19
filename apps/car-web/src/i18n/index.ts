import { en, type MessageKey } from "./en.ts"
import { formatMessage, type Lang } from "./format.ts"
import { ru } from "./ru.ts"

export type { MessageKey } from "./en.ts"
export type { Lang } from "./format.ts"

const catalogs: Record<Lang, Record<MessageKey, string>> = { en, ru }

export type TFn = (key: MessageKey, params?: Record<string, string | number>) => string

export const translate = (lang: Lang, key: MessageKey, params?: Record<string, string | number>): string =>
  formatMessage(lang, catalogs[lang][key], params)

export const makeT =
  (lang: Lang): TFn =>
  (key, params) =>
    translate(lang, key, params)
