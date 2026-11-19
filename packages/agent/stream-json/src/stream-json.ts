import { Data, Effect, Option, Schema, Stream } from "effect"
import { AgentEvent } from "@bot/core-contracts/agent-event"
import { ApiCreditsExhausted, SubscriptionLimitReached } from "@bot/core-contracts/errors"
import { ClaudeSessionId } from "@bot/core-contracts/ids"

const opt = <S extends Schema.Top>(s: S) => Schema.optional(Schema.NullOr(s))

const Envelope = Schema.Struct({ type: Schema.String, subtype: opt(Schema.String) })

const SystemInit = Schema.Struct({
  session_id: Schema.String,
  model: opt(Schema.String)
})

const ContentBlock = Schema.Struct({
  type: Schema.String,
  text: opt(Schema.String),
  name: opt(Schema.String),
  input: opt(Schema.Unknown)
})

const AssistantLine = Schema.Struct({
  error: opt(Schema.String),
  message: Schema.Struct({ content: opt(Schema.Array(ContentBlock)) })
})

const StreamEventLine = Schema.Struct({
  event: Schema.Struct({
    type: Schema.String,
    delta: opt(Schema.Struct({ type: Schema.String, text: opt(Schema.String) }))
  })
})

const ResultLine = Schema.Struct({
  session_id: opt(Schema.String),
  is_error: opt(Schema.Boolean),
  result: opt(Schema.String),
  errors: opt(Schema.Array(Schema.String)),
  api_error_status: opt(Schema.Number),
  total_cost_usd: opt(Schema.Number),
  num_turns: opt(Schema.Number),
  duration_ms: opt(Schema.Number),
  usage: opt(Schema.Struct({ input_tokens: opt(Schema.Number), output_tokens: opt(Schema.Number) }))
})

const RateLimitLine = Schema.Struct({
  rate_limit_info: opt(Schema.Struct({ status: opt(Schema.String), resetsAt: opt(Schema.Number) }))
})

/** Internal parsed form of a CLI line, before limit detection. */
type Parsed = Data.TaggedEnum<{
  Init: { readonly sessionId: string; readonly model: string }
  Delta: { readonly text: string }
  Assistant: { readonly events: ReadonlyArray<AgentEvent>; readonly error: string | undefined }
  Result: {
    readonly sessionId: string
    readonly isError: boolean
    readonly text: string
    readonly apiErrorStatus: number | undefined
    readonly costUsd: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly durationMs: number
    readonly numTurns: number
  }
  RateLimit: { readonly status: string | undefined; readonly resetsAt: number | undefined }
}>
const Parsed = Data.taggedEnum<Parsed>()

const PREVIEW_MAX = 80

const truncate = (s: string, max = PREVIEW_MAX): string => {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const PREVIEW_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"]

/** "Bash: ls -la", "Read: /workspace/a.csv"; MCP tool names are shortened to the tool part. */
export const summarizeToolCall = (name: string, input: unknown): string => {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  let preview: string | undefined
  for (const k of PREVIEW_KEYS) {
    const v = rec[k]
    if (typeof v === "string" && v.length > 0) {
      preview = v
      break
    }
  }
  if (preview === undefined) {
    const first = Object.values(rec).find((v) => typeof v === "string" && v.length > 0)
    if (typeof first === "string") preview = first
  }
  const shortName = name.startsWith("mcp__") ? name.split("__").slice(2).join("__") || name : name
  return preview === undefined ? shortName : `${shortName}: ${truncate(preview)}`
}

const decodeEnvelope = Schema.decodeUnknownOption(Envelope)
const decodeInit = Schema.decodeUnknownOption(SystemInit)
const decodeAssistant = Schema.decodeUnknownOption(AssistantLine)
const decodeStreamEvent = Schema.decodeUnknownOption(StreamEventLine)
const decodeResult = Schema.decodeUnknownOption(ResultLine)
const decodeRateLimit = Schema.decodeUnknownOption(RateLimitLine)

const parseJson = (line: string): Option.Option<unknown> => {
  const t = line.trim()
  if (t.length === 0 || t[0] !== "{") return Option.none()
  try {
    return Option.some(JSON.parse(t))
  } catch {
    return Option.none()
  }
}

const parseLine = (line: string): Option.Option<Parsed> =>
  Option.gen(function* () {
    const json = yield* parseJson(line)
    const env = yield* decodeEnvelope(json)
    switch (env.type) {
      case "system": {
        if (env.subtype !== "init") return yield* Option.none()
        const i = yield* decodeInit(json)
        return Parsed.Init({ sessionId: i.session_id, model: i.model ?? "" })
      }
      case "stream_event": {
        const s = yield* decodeStreamEvent(json)
        const d = s.event.delta
        if (s.event.type === "content_block_delta" && d?.type === "text_delta" && d.text) {
          return Parsed.Delta({ text: d.text })
        }
        return yield* Option.none()
      }
      case "assistant": {
        const a = yield* decodeAssistant(json)
        const events: Array<AgentEvent> = []
        for (const b of a.message.content ?? []) {
          if (b.type === "text" && b.text) events.push(AgentEvent.AssistantText({ text: b.text }))
          else if (b.type === "tool_use" && b.name) {
            events.push(AgentEvent.ToolCall({ name: b.name, summary: summarizeToolCall(b.name, b.input) }))
          }
        }
        return Parsed.Assistant({ events, error: a.error ?? undefined })
      }
      case "result": {
        const r = yield* decodeResult(json)
        const text = r.result ?? (r.errors ?? []).join("\n")
        return Parsed.Result({
          sessionId: r.session_id ?? "",
          isError: r.is_error ?? (env.subtype !== undefined && env.subtype !== null && env.subtype !== "success"),
          text,
          apiErrorStatus: r.api_error_status ?? undefined,
          costUsd: r.total_cost_usd ?? 0,
          inputTokens: r.usage?.input_tokens ?? 0,
          outputTokens: r.usage?.output_tokens ?? 0,
          durationMs: r.duration_ms ?? 0,
          numTurns: r.num_turns ?? 0
        })
      }
      case "rate_limit_event": {
        const r = yield* decodeRateLimit(json)
        return Parsed.RateLimit({
          status: r.rate_limit_info?.status ?? undefined,
          resetsAt: r.rate_limit_info?.resetsAt ?? undefined
        })
      }
      default:
        return yield* Option.none()
    }
  })

const toEvents = (p: Parsed): ReadonlyArray<AgentEvent> => {
  switch (p._tag) {
    case "Init":
      return [AgentEvent.SessionStarted({ sessionId: ClaudeSessionId.make(p.sessionId), model: p.model })]
    case "Delta":
      return [AgentEvent.TextDelta({ text: p.text })]
    case "Assistant":
      return p.events
    case "Result":
      return [completed(p)]
    case "RateLimit":
      return []
  }
}

const completed = (r: Extract<Parsed, { _tag: "Result" }>): AgentEvent =>
  AgentEvent.Completed({
    sessionId: ClaudeSessionId.make(r.sessionId),
    text: r.text,
    isError: r.isError,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    durationMs: r.durationMs,
    numTurns: r.numTurns
  })

/**
 * Stateless decode of one stdout line. Unknown / malformed / blank lines give `None`.
 * Returns only the first event of a multi-block assistant line; use `decodeLineEvents` for all.
 * Usage-limit detection needs cross-line state and lives in `toAgentEvents`.
 */
export const decodeLine = (line: string): Effect.Effect<Option.Option<AgentEvent>> =>
  Effect.sync(() => Option.flatMapNullishOr(parseLine(line), (p) => toEvents(p)[0]))

export const decodeLineEvents = (line: string): Effect.Effect<ReadonlyArray<AgentEvent>> =>
  Effect.sync(() => Option.match(parseLine(line), { onNone: () => [], onSome: toEvents }))

const CREDITS_TEXT = /credit balance is too low|insufficient credit|billing/i
const LIMIT_TEXT = /usage limit|hit your limit|limit reached|usage_limit_reached/i
const EPOCH_PIPE = /\|\s*(\d{9,})/

/** CLI timestamps are epoch seconds; accept ms too. */
const toEpochMillis = (n: number): number => (n < 1e12 ? n * 1000 : n)

const parseResetFromText = (text: string): number | undefined => {
  const m = EPOCH_PIPE.exec(text)
  return m?.[1] === undefined ? undefined : toEpochMillis(Number(m[1]))
}

interface State {
  readonly assistantError: string | undefined
  readonly rejectedResetsAt: number | undefined
  readonly rejected: boolean
  readonly lastResetsAt: number | undefined
}

type Item = { readonly event: AgentEvent } | { readonly limit: SubscriptionLimitReached | ApiCreditsExhausted }

const initial = (): State => ({
  assistantError: undefined,
  rejectedResetsAt: undefined,
  rejected: false,
  lastResetsAt: undefined
})

const limitError = (resetsAt: number | undefined) =>
  resetsAt === undefined ? new SubscriptionLimitReached({}) : new SubscriptionLimitReached({ resetsAt })

const step = (s: State, p: Parsed): readonly [State, ReadonlyArray<Item>] => {
  switch (p._tag) {
    case "RateLimit": {
      const resetsAt = p.resetsAt === undefined ? s.lastResetsAt : toEpochMillis(p.resetsAt)
      const rejected = s.rejected || p.status === "rejected"
      return [{ ...s, rejected, lastResetsAt: resetsAt }, []]
    }
    case "Assistant": {
      // Limit/auth failures arrive as a synthetic assistant message; its text is not model output.
      const events = p.error === "rate_limit" ? [] : p.events
      return [
        p.error !== undefined ? { ...s, assistantError: p.error } : s,
        events.map((event) => ({ event }))
      ]
    }
    case "Result": {
      if (p.isError && CREDITS_TEXT.test(p.text)) return [s, [{ limit: new ApiCreditsExhausted() }]]
      if (p.isError) {
        const limited =
          s.assistantError === "rate_limit" ||
          p.apiErrorStatus === 429 ||
          s.rejected ||
          LIMIT_TEXT.test(p.text)
        if (limited) return [s, [{ limit: limitError(parseResetFromText(p.text) ?? s.lastResetsAt) }]]
      }
      return [s, [{ event: completed(p) }]]
    }
    default:
      return [s, toEvents(p).map((event) => ({ event }))]
  }
}

/**
 * Raw stdout lines -> AgentEvents. Fails with SubscriptionLimitReached when the CLI reports an
 * exhausted subscription limit (instead of emitting a Completed); any other `is_error` result
 * becomes `Completed{isError:true}`. Unknown line types are skipped.
 */
export const toAgentEvents = <E, R>(
  lines: Stream.Stream<string, E, R>
): Stream.Stream<AgentEvent, E | SubscriptionLimitReached | ApiCreditsExhausted, R> =>
  lines.pipe(
    Stream.map((line) => Option.toArray(parseLine(line))),
    Stream.flattenIterable,
    Stream.mapAccum(initial, step),
    Stream.mapEffect((item) => ("limit" in item ? Effect.fail(item.limit) : Effect.succeed(item.event)))
  )
