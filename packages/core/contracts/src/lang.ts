import { Schema } from "effect"

export const Lang = Schema.Literals(["ru", "en"])
export type Lang = typeof Lang.Type

export const defaultLang: Lang = "en"

/** Telegram `from.language_code` → our Lang. Russian-speaking locales map to "ru". */
export const langFromTelegram = (code: string | undefined): Lang => {
  if (code === undefined) return defaultLang
  const base = code.toLowerCase().split("-")[0]
  return base === "ru" || base === "uk" || base === "be" || base === "kk" ? "ru" : "en"
}

/** A value per language. Every user-facing string in the bot is a `Localized`. */
export type Localized<A = string> = { readonly [L in Lang]: A }

type MessageValue = string | ((...args: ReadonlyArray<never>) => string)

/**
 * Each package owns its own message catalog:
 *   const messages = defineMessages({ ru: { hi: "Привет" }, en: { hi: "Hi" } })
 *   messages[lang].hi
 * The `en` shape is the source of truth; `ru` must have the same keys and signatures.
 */
export const defineMessages = <const M extends Record<string, MessageValue>>(catalog: {
  readonly en: M
  readonly ru: { readonly [K in keyof M]: M[K] extends string ? string : M[K] }
}): Localized<M> => catalog as Localized<M>
