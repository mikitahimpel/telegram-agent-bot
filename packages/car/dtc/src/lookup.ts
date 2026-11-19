import type { Severity } from "@bot/car-format/insights"
import { CATALOG, catalogCodes } from "./catalog.ts"
import { genericGroupText, type Lang } from "./generic.ts"
import { GROUPS } from "./groups.ts"

export type { Lang } from "./generic.ts"
export { catalogCodes } from "./catalog.ts"

export type DtcInfo = {
  readonly code: string
  readonly title: string
  readonly meaning: string
  readonly severity: Severity
  readonly canDrive: string
  readonly commonCauses: ReadonlyArray<string>
  readonly whatToDo: string
  readonly source: "catalog" | "generic"
}

const index = new Map(CATALOG.map((entry) => [entry.code, entry] as const))
const known = new Set(catalogCodes)

const normalize = (code: string): string => code.trim().toUpperCase()

export const isCatalogued = (code: string): boolean => known.has(normalize(code))

export const explainDtc = (code: string, lang: Lang): DtcInfo => {
  const normalized = normalize(code)
  const entry = index.get(normalized)
  if (entry !== undefined) {
    const group = GROUPS[entry.group]
    const text = group[lang]
    return {
      code: normalized,
      title: lang === "ru" ? entry.ru : entry.en,
      meaning: text.meaning,
      severity: entry.severity ?? group.severity,
      canDrive: text.drive,
      commonCauses: text.causes,
      whatToDo: text.todo,
      source: "catalog"
    }
  }
  return { code: normalized, ...genericGroupText(normalized, lang), source: "generic" }
}
