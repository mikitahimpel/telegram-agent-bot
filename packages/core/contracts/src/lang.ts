import { Schema } from "effect"

export const Lang = Schema.Literals(["ru", "en"])
export type Lang = typeof Lang.Type

export const defaultLang: Lang = "en"

export const langFromTelegram = (code: string | undefined): Lang => {
  if (code === undefined) return defaultLang
  const base = code.toLowerCase().split("-")[0]
  return base === "ru" || base === "uk" || base === "be" || base === "kk" ? "ru" : "en"
}

export type Localized<A = string> = { readonly [L in Lang]: A }

type MessageValue = string | ((...args: ReadonlyArray<never>) => string)

export const defineMessages = <const M extends Record<string, MessageValue>>(catalog: {
  readonly en: M
  readonly ru: { readonly [K in keyof M]: M[K] extends string ? string : M[K] }
}): Localized<M> => catalog as Localized<M>
