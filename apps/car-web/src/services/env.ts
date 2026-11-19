import { detectCapabilities } from "@bot/car-obd/capabilities"
import { detectLang, type Lang } from "../i18n/format.ts"
import type { Capabilities, Platform } from "../model/types.ts"

export const detectPlatform = (ua: string): Platform => {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
  if (/Android/i.test(ua)) return "android"
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop"
  return "other"
}

export const isTelegramWebview = (ua: string, w: { TelegramWebviewProxy?: unknown } = globalThis as never): boolean =>
  /Telegram/i.test(ua) || w.TelegramWebviewProxy !== undefined

/** Language comes from the browser; the user can override it in Settings. */
export const initialLang = (navLang: string | undefined, saved: string | null | undefined): Lang =>
  saved === "ru" || saved === "en" ? saved : detectLang(navLang)

export const localCapabilities = (): Capabilities => detectCapabilities()

/**
 * "intent://host/path#pair=CODE#Intent;scheme=https;package=com.android.chrome;end"
 * Keeps the pair hash so Chrome can complete pairing.
 */
export const buildChromeIntentUrl = (loc: { host: string; pathname: string; search?: string; hash: string }): string =>
  `intent://${loc.host}${loc.pathname}${loc.search ?? ""}${loc.hash}#Intent;scheme=https;package=com.android.chrome;end`
