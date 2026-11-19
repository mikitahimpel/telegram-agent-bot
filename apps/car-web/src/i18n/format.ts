export type Lang = "ru" | "en"

type Params = Record<string, string | number>

/**
 * Tiny template formatter: `{name}` inserts a value, `{n#one|other}` (en) or `{n#one|few|many}` (ru)
 * prints the number followed by its plural form.
 */
export const formatMessage = (lang: Lang, template: string, params: Params = {}): string =>
  template.replace(/\{(\w+)(?:#([^}]+))?\}/g, (_m, name: string, forms?: string) => {
    const v = params[name]
    if (v === undefined) return `{${name}}`
    if (!forms) return String(v)
    const parts = forms.split("|")
    const n = Number(v)
    const cat = new Intl.PluralRules(lang).select(n)
    const idx = lang === "ru" ? (cat === "one" ? 0 : cat === "few" ? 1 : 2) : cat === "one" ? 0 : 1
    return `${fmtNumber(lang, n)} ${parts[Math.min(idx, parts.length - 1)] ?? ""}`
  })

export const detectLang = (code: string | undefined | null): Lang => (code && code.toLowerCase().startsWith("ru") ? "ru" : "en")

export const fmtNumber = (lang: Lang, n: number, fractionDigits?: number): string =>
  new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", fractionDigits === undefined ? {} : { maximumFractionDigits: fractionDigits }).format(n)

export const fmtClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${p(h)}:${p(m)}:${p(s % 60)}`
}

export const fmtDateTime = (lang: Lang, ms: number): string =>
  new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ms))

export const fmtTime = (lang: Lang, ms: number): string =>
  new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms))

export const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
