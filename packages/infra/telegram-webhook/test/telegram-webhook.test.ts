import { describe, expect, it } from "vite-plus/test"
import { Effect, Redacted } from "effect"
import { ALLOWED_UPDATES, callTelegram, scopeBody } from "../src/telegram-webhook.ts"

describe("telegram-webhook helpers", () => {
  it("builds scope bodies", () => {
    expect(scopeBody({ scope: { type: "default" }, languageCode: undefined })).toEqual({ scope: { type: "default" } })
    expect(scopeBody({ scope: { type: "chat", chatId: 7 }, languageCode: "ru" })).toEqual({
      scope: { type: "chat", chat_id: 7 },
      language_code: "ru"
    })
  })

  it("subscribes to stopped_message_generation", () => {
    expect(ALLOWED_UPDATES).toContain("stopped_message_generation")
  })

  it("posts JSON to the method URL and fails on ok:false", async () => {
    const calls: Array<{ url: string; body: string }> = []
    const fake = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body })
      return {
        status: 200,
        json: async () => (url.endsWith("bad") ? { ok: false, description: "nope" } : { ok: true })
      }
    }) as unknown as typeof fetch
    const token = Redacted.make("T")
    await Effect.runPromise(callTelegram(token, "setWebhook", { url: "u" }, fake))
    expect(calls[0]?.url).toBe("https://api.telegram.org/botT/setWebhook")
    expect(JSON.parse(calls[0]!.body)).toEqual({ url: "u" })
    const err = await Effect.runPromise(Effect.flip(callTelegram(token, "bad", {}, fake)))
    expect(err.description).toBe("nope")
  })
})
