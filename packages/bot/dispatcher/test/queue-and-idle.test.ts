import { describe, expect, it } from "vitest"
import type { SessionKey } from "@bot/core-contracts/ids"
import { isIdleExpired } from "../src/conversation.ts"
import { makePromptQueue, mergePrompts } from "../src/prompt-queue.ts"

const key = "main" as SessionKey

describe("prompt queue", () => {
  it("caps at five and drains in order", () => {
    const q = makePromptQueue()
    for (let n = 0; n < 5; n++) expect(q.push(key, { prompt: String(n) })).toBe("queued")
    expect(q.push(key, { prompt: "x" })).toBe("full")
    expect(q.drain(key).map((i) => i.prompt)).toEqual(["0", "1", "2", "3", "4"])
    expect(q.size(key)).toBe(0)
  })

  it("merges prompts and attachments", () => {
    const a = { fileName: "a", mimeType: "x", bytes: new Uint8Array([1]) }
    const b = { fileName: "b", mimeType: "x", bytes: new Uint8Array([2]) }
    const merged = mergePrompts([
      { prompt: "one", media: { attachments: [a], heard: undefined } },
      { prompt: "two", media: { attachments: [b], heard: undefined } }
    ])
    expect(merged.prompt).toBe("one\n\ntwo")
    expect(merged.media?.attachments).toEqual([a, b])
    expect(mergePrompts([{ prompt: "solo" }])).toEqual({ prompt: "solo" })
  })
})

describe("idle reset", () => {
  it("expires after the configured hours", () => {
    const h = 3_600_000
    expect(isIdleExpired(0, 6 * h - 1, 6)).toBe(false)
    expect(isIdleExpired(0, 6 * h, 6)).toBe(true)
    expect(isIdleExpired(0, 100 * h, 0)).toBe(false)
  })
})
