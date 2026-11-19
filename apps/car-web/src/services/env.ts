import type { AppMode, Capabilities, Platform } from "../model/types.ts"
import { detectLang, type Lang } from "../i18n/format.ts"

export const detectPlatform = (ua: string): Platform => {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
  if (/Android/i.test(ua)) return "android"
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop"
  return "other"
}

export const detectMode = (initData: string): AppMode => (initData.length > 0 ? "telegram" : "chrome")

export const initialLang = (mode: AppMode, tgLang: string | undefined, navLang: string | undefined): Lang =>
  detectLang(mode === "telegram" ? tgLang : navLang)

/** Local detection until @bot/car-obd `./capabilities` is wired. */
export const localCapabilities = (inTelegram: boolean): Capabilities => {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { bluetooth?: unknown; serial?: unknown })
  const reasons: string[] = []
  const ble = !!nav?.bluetooth
  const serial = !!nav?.serial
  if (!ble) reasons.push("navigator.bluetooth is undefined")
  if (!serial) reasons.push("navigator.serial is undefined")
  return { ble, serial, secureContext: typeof isSecureContext === "undefined" ? true : isSecureContext, inTelegram, reasons }
}
