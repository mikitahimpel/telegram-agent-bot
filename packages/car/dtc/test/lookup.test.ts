import { describe, expect, it } from "vite-plus/test"
import { CATALOG, catalogCodes } from "../src/catalog.ts"
import { GROUPS } from "../src/groups.ts"
import { explainDtc, isCatalogued } from "../src/lookup.ts"

describe("catalog", () => {
  it("has at least 200 generic P0 codes and unique codes", () => {
    expect(catalogCodes.filter((c) => c.startsWith("P0")).length).toBeGreaterThanOrEqual(200)
    expect(new Set(catalogCodes).size).toBe(catalogCodes.length)
  })

  it("has well-formed entries", () => {
    for (const entry of CATALOG) {
      expect(entry.code).toMatch(/^[PU][0-9A-F]{4}$/)
      expect(entry.en.trim()).not.toBe("")
      expect(entry.ru.trim()).not.toBe("")
      expect(Object.keys(GROUPS)).toContain(entry.group)
    }
    for (const group of Object.values(GROUPS)) {
      for (const lang of ["en", "ru"] as const) {
        const t = group[lang]
        expect(t.meaning).not.toBe("")
        expect(t.todo).not.toBe("")
        expect(t.drive).not.toBe("")
        expect(t.causes.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("explainDtc", () => {
  it("resolves known codes from the catalog in both languages", () => {
    for (const code of ["P0420", "P0171", "P0300", "P0128", "P0455", "P0562", "U0100"]) {
      for (const lang of ["ru", "en"] as const) {
        const info = explainDtc(code, lang)
        expect(info.source).toBe("catalog")
        expect(info.title).not.toBe("")
        expect(info.commonCauses.length).toBeGreaterThan(0)
      }
    }
    expect(explainDtc("P0300", "en").severity).toBe("urgent")
    expect(explainDtc("P0420", "ru").title).toContain("катализатор")
  })

  it("falls back to generic by family", () => {
    for (const code of ["P1234", "P3000", "B1234", "C0035", "U1000", "P0999"]) {
      for (const lang of ["ru", "en"] as const) {
        const info = explainDtc(code, lang)
        expect(info.source).toBe("generic")
        expect(info.severity).toBe("watch")
        expect(info.whatToDo).not.toBe("")
      }
    }
    expect(explainDtc("P1234", "en").title).toContain("Manufacturer-specific")
    expect(explainDtc("P1334", "en").title).toContain("ignition")
  })

  it("normalises input and never throws", () => {
    expect(explainDtc(" p0420 ", "en").code).toBe("P0420")
    expect(isCatalogued("p0171")).toBe(true)
    expect(isCatalogued("P1234")).toBe(false)
    expect(() => explainDtc("xyz", "en")).not.toThrow()
    expect(explainDtc("", "ru").source).toBe("generic")
  })
})
