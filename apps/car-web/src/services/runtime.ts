import { getTelegram } from "../telegram/webapp.ts"
import { createDemoBackend } from "./demo-backend.ts"
import type { CarBackend } from "./backend.ts"
import { detectMode, detectPlatform, localCapabilities } from "./env.ts"

export const API_BASE = "/car/api"

/**
 * Backend factory.
 * TODO(wire): once @bot/car-obd and @bot/car-recorder exist, build ONE ManagedRuntime from
 * makeCarRuntime({ apiBase: API_BASE, initData }) (Telegram) or makeCarRuntime({ apiBase, credential }) (Chrome,
 * credential from `./credentials`), and implement CarBackend by mirroring each SubscriptionRef with
 * useSubscriptionRef() and mapping Effect state -> src/model/types.ts (the mapping lives in this file only).
 */
export const createBackend = (): CarBackend => {
  const tg = getTelegram()
  const mode = detectMode(tg.initData)
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  return createDemoBackend({
    mode,
    platform: detectPlatform(ua),
    caps: localCapabilities(mode === "telegram"),
    trips: [],
    diag: [],
    pairing: mode === "chrome" ? "unpaired" : "paired"
  })
}
