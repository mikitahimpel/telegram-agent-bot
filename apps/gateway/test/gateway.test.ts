import { describe, expect, it } from "vitest"
import { daysLeft, parseIssuedAt, reminderStage, TOKEN_LIFETIME_DAYS } from "../src/token-expiry.ts"
import { configRecord } from "../src/config.ts"
import { secretMatches } from "../src/webhook.ts"
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
    expect(rec).toMatchObject({ ADMIN_TG_ID: "1", R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: "AK", CAR_BUCKET_NAME: "data" })
  })
})
