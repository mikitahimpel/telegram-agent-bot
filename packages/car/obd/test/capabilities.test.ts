import { describe, expect, it } from "@effect/vitest"
import { detectCapabilities } from "../src/capabilities.ts"

describe("detectCapabilities", () => {
  it("reports reasons for an iPhone in Telegram", () => {
    const c = detectCapabilities({
      navigator: { userAgent: "Mozilla/5.0 (iPhone)" },
      isSecureContext: true,
      Telegram: { WebApp: { initData: "x" } }
    })
    expect(c).toMatchObject({ ble: false, serial: false, secureContext: true, inTelegram: true })
    expect(c.reasons).toEqual(["ble_unsupported", "serial_unsupported", "ios_webkit"])
  })
  it("android chrome", () => {
    const c = detectCapabilities({ navigator: { bluetooth: {}, userAgent: "Android" }, isSecureContext: true })
    expect(c.ble).toBe(true)
    expect(c.reasons).toEqual(["serial_unsupported"])
  })
})
