import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { TelegramError } from "@bot/core-contracts/errors"
import { AgentEvent } from "@bot/core-contracts/agent-event"
import type { ChatId, ClaudeSessionId } from "@bot/core-contracts/ids"
import { recordingTelegram } from "@bot/telegram-client/testing"
import { presentRun } from "../src/streaming.ts"

const target = { chatId: 1 as ChatId }
const completed = (text: string, isError = false) =>
  AgentEvent.Completed({
    sessionId: "s" as ClaudeSessionId,
    text,
    isError,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    numTurns: 1
  })
const methods = (calls: ReadonlyArray<{ method: string }>) => calls.map((c) => c.method)

describe("presentRun", () => {
  it.effect("throttles drafts and sends the final message", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      const queue = yield* Queue.unbounded<AgentEvent | null>()
      const stream = Stream.fromQueue(queue).pipe(Stream.takeWhile((e): e is AgentEvent => e !== null))
      const fiber = yield* Effect.forkChild(presentRun(stream, target, { lang: "en", draftId: 5 }))
      yield* Queue.offer(queue, AgentEvent.TextDelta({ text: "Hel" }))
      yield* Effect.yieldNow
      yield* Queue.offer(queue, AgentEvent.TextDelta({ text: "lo" }))
      yield* Effect.yieldNow
      expect(methods(calls)).toEqual(["sendMessageDraft", "sendMessageDraft"])
      yield* TestClock.adjust("800 millis")
      yield* Queue.offer(queue, AgentEvent.TextDelta({ text: " **w**" }))
      yield* Effect.yieldNow
      expect(methods(calls)).toEqual(["sendMessageDraft", "sendMessageDraft", "sendMessageDraft"])
      expect(calls[2]!.args).toEqual([{ chatId: 1, draftId: 5 }, "Hello <b>w</b>"])
      yield* Queue.offer(queue, completed("Hello **w**"))
      yield* Queue.offer(queue, null)
      const r = yield* Fiber.join(fiber)
      expect(r.completed?._tag).toBe("Completed")
      expect(calls[3]).toEqual({ method: "sendMessage", args: [target, "Hello <b>w</b>"] })
    }).pipe(Effect.provide(layer))
  })

  it.effect("shows localized tool status", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(AgentEvent.ToolCall({ name: "Bash", summary: "ls <x>" })), target, {
        lang: "ru",
        draftId: 1
      })
      expect(calls[1]!.args[1]).toBe("<i>🔧 Bash: ls &lt;x&gt;</i>")
      const r = yield* presentRun(
        Stream.make(AgentEvent.TextDelta({ text: "x" }), AgentEvent.ToolCall({ name: "Read", summary: "" })),
        target,
        { lang: "en", draftId: 1, throttleMs: 0 }
      )
      expect(r.completed).toBeUndefined()
    }).pipe(Effect.provide(layer))
  })

  it.effect("shows human status for non-admins", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(AgentEvent.ToolCall({ name: "WebSearch", summary: "cats" })), target, {
        lang: "ru",
        draftId: 1,
        statusStyle: "human"
      })
      expect(calls[1]!.args[1]).toBe("<i>Ищу в интернете…</i>")
    }).pipe(Effect.provide(layer))
  })

  it.effect("never shows the raw English error text of a failed run to the user", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(completed("API Error: 529 overloaded_error", true)), target, {
        lang: "ru",
        draftId: 1
      })
      const sent = calls.filter((c) => c.method === "sendMessage").map((c) => c.args[1])
      expect(sent).toEqual(["⚠️ Что-то пошло не так, попробуйте ещё раз чуть позже."])
    }).pipe(Effect.provide(layer))
  })

  it.effect("splits long final answers into chunks", () => {
    const { layer, calls } = recordingTelegram()
    const text = Array.from({ length: 150 }, (_, i) => `para ${i} ${"x".repeat(30)}`).join("\n\n")
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(completed(text)), target, { lang: "en", draftId: 1 })
      const sends = calls.filter((c) => c.method === "sendMessage")
      expect(sends.length).toBeGreaterThan(1)
      for (const s of sends) expect((s.args[1] as string).length).toBeLessThanOrEqual(4096)
      expect(calls.some((c) => c.method === "sendDocument")).toBe(false)
    }).pipe(Effect.provide(layer))
  })

  it.effect("sends a .md document above 12000 chars", () => {
    const { layer, calls } = recordingTelegram()
    const text = "a".repeat(12001)
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(completed(text)), target, { lang: "en", draftId: 1 })
      expect(methods(calls)).toEqual(["sendMessageDraft", "sendDocument"])
      const file = calls[1]!.args[1] as { fileName: string; bytes: Uint8Array }
      expect(file.fileName).toBe("answer.md")
      expect(file.bytes.length).toBe(12001)
    }).pipe(Effect.provide(layer))
  })

  it.effect("falls back to sendMessage once + editMessageText when drafts fail", () => {
    const { layer, calls } = recordingTelegram({
      fail: (c) =>
        c.method === "sendMessageDraft"
          ? new TelegramError({ method: c.method, errorCode: 400, description: "method not found" })
          : undefined
    })
    return Effect.gen(function* () {
      const queue = yield* Queue.unbounded<AgentEvent | null>()
      const stream = Stream.fromQueue(queue).pipe(Stream.takeWhile((e): e is AgentEvent => e !== null))
      const fiber = yield* Effect.forkChild(presentRun(stream, target, { lang: "en", draftId: 5 }))
      yield* Queue.offer(queue, AgentEvent.TextDelta({ text: "one" }))
      yield* Effect.yieldNow
      yield* TestClock.adjust("800 millis")
      yield* Queue.offer(queue, AgentEvent.TextDelta({ text: " two" }))
      yield* Effect.yieldNow
      yield* TestClock.adjust("800 millis")
      yield* Queue.offer(queue, AgentEvent.TextDelta({ text: " three" }))
      yield* Effect.yieldNow
      yield* Queue.offer(queue, completed("one two three"))
      yield* Queue.offer(queue, null)
      yield* Fiber.join(fiber)
      expect(methods(calls)).toEqual([
        "sendMessageDraft",
        "sendMessage",
        "editMessageText",
        "editMessageText",
        "editMessageText",
        "editMessageText"
      ])
      expect(calls[1]!.args[1]).toBe("Thinking…")
      expect(calls[5]!.args[1]).toBe("one two three")
    }).pipe(Effect.provide(layer))
  })

  it.effect("collects files and returns Completed", () => {
    const { layer } = recordingTelegram()
    return Effect.gen(function* () {
      const r = yield* presentRun(
        Stream.make(AgentEvent.FileProduced({ path: "/a", fileName: "a.txt" }), completed("done")),
        target,
        { lang: "en", draftId: 1 }
      )
      expect(r.files).toEqual([AgentEvent.FileProduced({ path: "/a", fileName: "a.txt" })])
      expect(r.completed?.text).toBe("done")
    }).pipe(Effect.provide(layer))
  })

  it.effect("propagates stream errors unchanged", () => {
    const { layer } = recordingTelegram()
    return Effect.gen(function* () {
      const e = yield* Effect.flip(presentRun(Stream.fail("boom" as const), target, { lang: "en", draftId: 1 }))
      expect(e).toBe("boom")
    }).pipe(Effect.provide(layer))
  })

  it.effect("retries with plain text when HTML is rejected", () => {
    let first = true
    const { layer, calls } = recordingTelegram({
      fail: (c) => {
        if (c.method === "sendMessage" && first) {
          first = false
          return new TelegramError({
            method: c.method,
            errorCode: 400,
            description: "Bad Request: can't parse entities"
          })
        }
        return undefined
      }
    })
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(completed("**hi**")), target, { lang: "en", draftId: 1 })
      expect(calls.map((c) => c.args[1])).toEqual(["Thinking…", "<b>hi</b>", "hi"])
    }).pipe(Effect.provide(layer))
  })

  it.effect("hides the choice marker while streaming and turns it into the final keyboard", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      const seen: Array<{ text: string; choices: ReadonlyArray<string> }> = []
      const r = yield* presentRun(
        Stream.make(
          AgentEvent.TextDelta({ text: "Shall we?\n[[butt" }),
          AgentEvent.TextDelta({ text: "ons: Yes | No]]" }),
          completed("Shall we?\n[[buttons: Yes | No]]")
        ),
        target,
        {
          lang: "en",
          draftId: 1,
          throttleMs: 0,
          finalKeyboard: (answer) => {
            seen.push(answer)
            return [[{ text: "Yes", callbackData: "ch:0" }]]
          }
        }
      )
      for (const c of calls.filter((x) => x.method === "sendMessageDraft")) {
        expect(String(c.args[1])).not.toContain("[")
      }
      expect(seen).toEqual([{ text: "Shall we?", choices: ["Yes", "No"] }])
      const final = calls.at(-1)!
      expect(final.method).toBe("sendMessage")
      expect(final.args[1]).toBe("Shall we?")
      expect(final.args[2]).toEqual({ keyboard: [[{ text: "Yes", callbackData: "ch:0" }]] })
      expect(r.choices).toEqual(["Yes", "No"])
      expect(r.keyboard).toBe(true)
      expect(r.messageId).toBeDefined()
    }).pipe(Effect.provide(layer))
  })

  it.effect("leaves a malformed marker in the text and attaches no choices", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      const r = yield* presentRun(Stream.make(completed("Pick\n[[buttons: Only]]")), target, {
        lang: "en",
        draftId: 1,
        finalKeyboard: (answer) => (answer.choices.length > 0 ? [[]] : undefined)
      })
      expect(calls.at(-1)?.args[1]).toContain("[[buttons: Only]]")
      expect(r.keyboard).toBe(false)
    }).pipe(Effect.provide(layer))
  })

  it.effect("shows a stop button on the working message and drops it with the answer", () => {
    const { layer, calls } = recordingTelegram()
    const stop = [[{ text: "Stop", callbackData: "stop:" }]]
    return Effect.gen(function* () {
      yield* presentRun(Stream.make(AgentEvent.TextDelta({ text: "Hi" }), completed("Hi there")), target, {
        lang: "en",
        draftId: 1,
        throttleMs: 0,
        stopKeyboard: stop
      })
      expect(methods(calls)).toEqual(["sendMessage", "editMessageText", "editMessageText"])
      expect(calls[0]!.args[2]).toEqual({ keyboard: stop })
      expect(calls[1]!.args[2]).toEqual({ keyboard: stop })
      expect(calls[2]!.args).toEqual([{ chatId: 1, messageId: 1 }, "Hi there"])
    }).pipe(Effect.provide(layer))
  })

  it.effect("clears the stop button when the run fails before an answer", () => {
    const { layer, calls } = recordingTelegram()
    return Effect.gen(function* () {
      const failed = yield* Effect.result(
        presentRun(Stream.concat(Stream.make(AgentEvent.TextDelta({ text: "Hi" })), Stream.fail("boom")), target, {
          lang: "en",
          draftId: 1,
          throttleMs: 0,
          stopKeyboard: [[{ text: "Stop", callbackData: "stop:" }]]
        })
      )
      expect(failed._tag).toBe("Failure")
      expect(calls.at(-1)).toEqual({ method: "editMessageReplyMarkup", args: [{ chatId: 1, messageId: 1 }] })
    }).pipe(Effect.provide(layer))
  })
})
