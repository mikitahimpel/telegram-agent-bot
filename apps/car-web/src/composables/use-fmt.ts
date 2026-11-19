import { fmtNumber } from "../i18n/format.ts"
import { useApp } from "../app-context.ts"

const DASH = "—"

export const useFmt = () => {
  const { lang, t } = useApp()
  const num = (n: number | null, d = 0) => (n === null ? DASH : fmtNumber(lang.value, n, d))
  const unit = (
    n: number | null,
    d: number,
    key: "unit.km" | "unit.kmh" | "unit.l" | "unit.l100" | "unit.v" | "unit.c" | "unit.rpm" | "unit.lph" | "unit.pct"
  ) => (n === null ? DASH : `${fmtNumber(lang.value, n, d)} ${t.value(key)}`)
  const dur = (seconds: number | null) => {
    if (seconds === null) return DASH
    const m = Math.round(seconds / 60)
    if (m < 1) return `${Math.round(seconds)} ${t.value("unit.s")}`
    if (m < 60) return `${m} ${t.value("unit.min")}`
    return `${Math.floor(m / 60)} ${t.value("unit.h")} ${m % 60} ${t.value("unit.min")}`
  }
  return {
    num,
    km: (n: number | null, d = 1) => unit(n, d, "unit.km"),
    kmh: (n: number | null) => unit(n, 0, "unit.kmh"),
    l: (n: number | null, d = 1) => unit(n, d, "unit.l"),
    l100: (n: number | null) => unit(n, 1, "unit.l100"),
    volts: (n: number | null) => unit(n, 1, "unit.v"),
    celsius: (n: number | null) => unit(n, 0, "unit.c"),
    rpm: (n: number | null) => unit(n, 0, "unit.rpm"),
    lph: (n: number | null) => unit(n, 1, "unit.lph"),
    pct: (n: number | null, d = 0) => unit(n, d, "unit.pct"),
    signedPct: (n: number | null) =>
      n === null ? DASH : `${n > 0 ? "+" : ""}${fmtNumber(lang.value, n, 0)} ${t.value("unit.pct")}`,
    dur
  }
}
