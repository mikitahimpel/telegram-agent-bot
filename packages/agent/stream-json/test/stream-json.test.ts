import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Stream } from "effect"
import { ApiCreditsExhausted, SubscriptionLimitReached } from "@bot/core-contracts/errors"
import { splitLines } from "../src/split-lines.ts"
import { decodeLine, toAgentEvents } from "../src/stream-json.ts"

const j = (o: unknown) => JSON.stringify(o)
const SID = "11111111-2222-3333-4444-555555555555"

const init = j({
  type: "system",
  subtype: "init",
  session_id: SID,
  model: "claude-sonnet-4-5",
  tools: [],
  mcp_servers: []
})
const delta = (text: string) =>
  j({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    session_id: SID
  })
const assistant = (content: unknown[], extra: object = {}) =>
  j({ type: "assistant", message: { role: "assistant", content }, session_id: SID, ...extra })
const result = (extra: object = {}) =>
  j({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    session_id: SID,
    num_turns: 2,
    total_cost_usd: 0.0123,
    duration_ms: 4200,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...extra
  })

const run = (lines: ReadonlyArray<string>) => Stream.runCollect(toAgentEvents(Stream.fromIterable(lines)))

describe("decodeLine", () => {
  it.effect("skips unknown, blank and malformed lines", () =>
    Effect.gen(function* () {
      for (const l of [
        "",
        "   ",
        "not json",
        "[1]",
        j({ type: "user", message: {} }),
        j({ type: "system", subtype: "status" }),
        j({ foo: 1 })
      ]) {
        expect(Option.isNone(yield* decodeLine(l))).toBe(true)
      }
    })
  )

  it.effect("system/init -> SessionStarted", () =>
    Effect.gen(function* () {
      const e = Option.getOrThrow(yield* decodeLine(init))
      expect(e).toMatchObject({ _tag: "SessionStarted", sessionId: SID, model: "claude-sonnet-4-5" })
    })
  )

  it.effect("text_delta -> TextDelta, other deltas skipped", () =>
    Effect.gen(function* () {
      expect(Option.getOrThrow(yield* decodeLine(delta("Hi")))).toMatchObject({ _tag: "TextDelta", text: "Hi" })
      const other = j({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } }
      })
      expect(Option.isNone(yield* decodeLine(other))).toBe(true)
    })
  )
})

describe("toAgentEvents", () => {
  it.effect("full happy path", () =>
    Effect.gen(function* () {
      const evs = yield* run([
        init,
        j({ type: "system", subtype: "status", status: "requesting" }),
        delta("Hel"),
        delta("lo"),
        assistant([
          { type: "thinking", thinking: "..." },
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }
        ]),
        j({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }
        }),
        j({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1900000000 } }),
        result()
      ])
      expect(evs.map((e) => e._tag)).toEqual([
        "SessionStarted",
        "TextDelta",
        "TextDelta",
        "AssistantText",
        "ToolCall",
        "Completed"
      ])
      expect(evs[4]).toMatchObject({ name: "Bash", summary: "Bash: ls -la" })
      expect(evs[5]).toMatchObject({
        _tag: "Completed",
        sessionId: SID,
        text: "done",
        isError: false,
        costUsd: 0.0123,
        inputTokens: 10,
        outputTokens: 20,
        durationMs: 4200,
        numTurns: 2
      })
    })
  )

  it.effect("tool summary truncates to <=80 chars of preview and shortens mcp names", () =>
    Effect.gen(function* () {
      const long = "echo " + "x".repeat(200)
      const evs = yield* run([
        assistant([
          { type: "tool_use", id: "a", name: "Bash", input: { command: long } },
          { type: "tool_use", id: "b", name: "mcp__bot__car_list_trips", input: { limit: 3 } },
          { type: "tool_use", id: "c", name: "Read", input: { file_path: "/workspace/a.csv" } }
        ])
      ])
      const s = evs.map((e) => (e._tag === "ToolCall" ? e.summary : ""))
      expect(s[0]!.length).toBeLessThanOrEqual("Bash: ".length + 80)
      expect(s[0]!.endsWith("…")).toBe(true)
      expect(s[1]).toBe("car_list_trips")
      expect(s[2]).toBe("Read: /workspace/a.csv")
    })
  )

  it.effect("result with is_error (auth failure) -> Completed isError", () =>
    Effect.gen(function* () {
      const evs = yield* run([
        init,
        assistant([{ type: "text", text: "Not logged in · Please run /login" }], { error: "authentication_failed" }),
        result({
          is_error: true,
          result: "Failed to authenticate. API Error: 401 Invalid bearer token",
          api_error_status: 401,
          num_turns: 1
        })
      ])
      expect(evs.at(-1)).toMatchObject({ _tag: "Completed", isError: true })
    })
  )

  it.effect("error_max_turns subtype without is_error is treated as error", () =>
    Effect.gen(function* () {
      const evs = yield* run([
        j({ type: "result", subtype: "error_max_turns", session_id: SID, errors: ["max turns"], num_turns: 30 })
      ])
      expect(evs[0]).toMatchObject({ _tag: "Completed", isError: true, text: "max turns", numTurns: 30 })
    })
  )

  it.effect("api key: credit balance too low -> ApiCreditsExhausted", () =>
    Effect.gen(function* () {
      const err = yield* run([init, result({ is_error: true, result: "Credit balance is too low" })]).pipe(Effect.flip)
      expect(err).toBeInstanceOf(ApiCreditsExhausted)
    })
  )

  it.effect("limit: legacy `|epoch` text", () =>
    Effect.gen(function* () {
      const err = yield* run([
        init,
        result({ is_error: true, result: "Claude AI usage limit reached|1900000000" })
      ]).pipe(Effect.flip)
      expect(err).toBeInstanceOf(SubscriptionLimitReached)
      expect(err._tag === "SubscriptionLimitReached" ? err.resetsAt : undefined).toBe(1900000000_000)
    })
  )

  it.effect("limit: assistant error rate_limit + rate_limit_event resetsAt; synthetic text suppressed", () =>
    Effect.gen(function* () {
      const seen: string[] = []
      const err = yield* Stream.runForEach(
        toAgentEvents(
          Stream.fromIterable([
            init,
            j({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1900000500 } }),
            assistant([{ type: "text", text: "You've hit your limit · resets 5pm" }], { error: "rate_limit" }),
            result({ is_error: true, result: "You've hit your limit" })
          ])
        ),
        (e) => Effect.sync(() => void seen.push(e._tag))
      ).pipe(Effect.flip)
      expect(seen).toEqual(["SessionStarted"])
      expect(err).toBeInstanceOf(SubscriptionLimitReached)
      expect((err as SubscriptionLimitReached).resetsAt).toBe(1900000500_000)
    })
  )

  it.effect("limit: 429 status with no reset info", () =>
    Effect.gen(function* () {
      const err = yield* run([result({ is_error: true, result: "API Error", api_error_status: 429 })]).pipe(Effect.flip)
      expect(err).toBeInstanceOf(SubscriptionLimitReached)
      expect((err as SubscriptionLimitReached).resetsAt).toBeUndefined()
    })
  )

  it.effect("rate_limit_event allowed_warning alone does not fail a successful run", () =>
    Effect.gen(function* () {
      const evs = yield* run([
        j({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning" } }),
        result()
      ])
      expect(evs.map((e) => e._tag)).toEqual(["Completed"])
    })
  )

  it.effect("propagates upstream errors", () =>
    Effect.gen(function* () {
      const e = yield* Stream.runCollect(toAgentEvents(Stream.fail("boom" as const))).pipe(Effect.flip)
      expect(e).toBe("boom")
    })
  )
})

describe("splitLines", () => {
  const enc = new TextEncoder()
  const collect = (chunks: ReadonlyArray<Uint8Array>) => Stream.runCollect(splitLines(Stream.fromIterable(chunks)))

  it.effect("joins partial chunks and flushes trailing line", () =>
    Effect.gen(function* () {
      expect(
        yield* collect([enc.encode('{"a":'), enc.encode('1}\n{"b"'), enc.encode(":2}\n"), enc.encode("tail")])
      ).toEqual(['{"a":1}', '{"b":2}', "tail"])
    })
  )

  it.effect("handles multi-byte UTF-8 split across chunks", () =>
    Effect.gen(function* () {
      const bytes = enc.encode("привет 🚗\nok\n")
      const out = yield* collect([bytes.slice(0, 3), bytes.slice(3, 15), bytes.slice(15)])
      expect(out).toEqual(["привет 🚗", "ok"])
    })
  )

  it.effect("handles CRLF", () =>
    Effect.gen(function* () {
      expect(yield* collect([enc.encode("a\r\nb\r\n")])).toEqual(["a", "b"])
    })
  )
})
