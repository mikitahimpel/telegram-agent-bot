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

export const initialLang = (navLang: string | undefined, saved: string | null | undefined): Lang =>
  saved === "ru" || saved === "en" ? saved : detectLang(navLang)

export const botUrl = (username: string | undefined | null): string | null => {
  const u = (username ?? "").trim().replace(/^@/, "")
  return /^[A-Za-z0-9_]{3,}$/.test(u) ? `https://t.me/${u}` : null
}

export const localCapabilities = (): Capabilities => detectCapabilities()

export const buildChromeIntentUrl = (loc: { host: string; pathname: string; search?: string; hash: string }): string =>
  `intent://${loc.host}${loc.pathname}${loc.search ?? ""}${loc.hash}#Intent;scheme=https;package=com.android.chrome;end`
