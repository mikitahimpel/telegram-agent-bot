import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"
import { daysLeft, parseIssuedAt, reminderStage, TOKEN_LIFETIME_DAYS } from "../src/token-expiry.ts"
import { configRecord } from "../src/config.ts"
import { screenWebhook, secretMatches } from "../src/webhook.ts"
import type { Env } from "../src/env.ts"

describe("secretMatches", () => {
  it("accepts equal secrets and rejects everything else", async () => {
    expect(await secretMatches("abc", "abc")).toBe(true)
    expect(await secretMatches("abd", "abc")).toBe(false)
    expect(await secretMatches("abcd", "abc")).toBe(false)
    expect(await secretMatches(null, "abc")).toBe(false)
    expect(await secretMatches(null, "")).toBe(false)
    expect(await secretMatches("", "")).toBe(false)
  })
})

describe("token expiry", () => {
  const day = 86_400_000
  it("computes stages", () => {
    expect(reminderStage(200)).toBeUndefined()
    expect(reminderStage(30)).toBe(30)
    expect(reminderStage(8)).toBe(30)
    expect(reminderStage(7)).toBe(7)
    expect(reminderStage(2)).toBe(7)
    expect(reminderStage(1)).toBe(1)
    expect(reminderStage(0)).toBe(0)
    expect(reminderStage(-5)).toBe(0)
  })
  it("counts days from the issue date", () => {
    const issued = Date.parse("2026-01-01T00:00:00Z")
    expect(daysLeft(issued, issued)).toBe(TOKEN_LIFETIME_DAYS)
    expect(daysLeft(issued, issued + (TOKEN_LIFETIME_DAYS - 7) * day)).toBe(7)
    expect(parseIssuedAt("garbage")).toBeUndefined()
    expect(parseIssuedAt("2026-01-01")).toBe(issued)
  })
})

describe("configRecord", () => {
  it("derives the car presigner keys from the S3 credentials binding", () => {
    const env = {
      ADMIN_TG_ID: "1",
      R2_S3: JSON.stringify({
        endpoint: "https://acct123.r2.cloudflarestorage.com",
        bucketName: "data",
        region: "auto",
        accessKeyId: "AK",
        secretAccessKey: "SK"
      })
    } as unknown as Env
    const rec = configRecord(env)
    expect(rec).toMatchObject({
      ADMIN_TG_ID: "1",
      R2_ACCOUNT_ID: "acct123",
      R2_ACCESS_KEY_ID: "AK",
      CAR_BUCKET_NAME: "data"
    })
  })
})

describe("screenWebhook invites", () => {
  const env = (): Env =>
    ({
      TELEGRAM_WEBHOOK_SECRET: "s3cret",
      ADMIN_TG_ID: "1",
      KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [], list_complete: true })
      }
    }) as unknown as Env

  const post = (text: string, chatType = "private") =>
    new Request("https://x/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "s3cret" },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 77, type: chatType },
          from: { id: 77, is_bot: false, first_name: "X" },
          text,
          entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] : []
        }
      })
    })

  it("lets only an invite start through for unknown users", async () => {
    const code = "a".repeat(24)
    const invite = await Effect.runPromise(screenWebhook(post(`/start inv_${code}`), env()))
    expect(invite).toMatchObject({ _tag: "Invite", code })
    const withBot = await Effect.runPromise(screenWebhook(post(`/start@mybot inv_${code}`), env()))
    expect(withBot._tag).toBe("Invite")
    for (const text of ["hello", "/start", "/help", `/new inv_${code}`, "/start inv_short"]) {
      const outcome = await Effect.runPromise(screenWebhook(post(text), env()))
      expect(outcome).toMatchObject({ _tag: "Ignored", reason: "unknown user" })
    }
    const group = await Effect.runPromise(screenWebhook(post(`/start inv_${code}`, "group"), env()))
    expect(group._tag).toBe("Ignored")
  })
})
