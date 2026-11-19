import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { makeRegistry } from "@bot/bot-commands/registry"
import { layer as sessionsLayer, type SqlStorageLike } from "@bot/agent-sessions/sessions"
import { AgentEvent } from "@bot/core-contracts/agent-event"
import { AgentRunner } from "@bot/core-contracts/agent-runner"
import { Allowlist } from "@bot/core-contracts/allowlist"
import type { CommandDef } from "@bot/core-contracts/commands"
import { ClaudeSessionId, TgId } from "@bot/core-contracts/ids"
import { Sessions } from "@bot/core-contracts/sessions"
import { Telegram } from "@bot/core-contracts/telegram"
import type { Update } from "@bot/telegram-schema/schema"
import { AdminNotifier } from "../src/admin-notifier.ts"
import { makeDispatcher } from "../src/dispatcher.ts"
import { McpAccess } from "../src/mcp-access.ts"
import { layer as runControlLayer } from "../src/run-control.ts"
import { RunControl } from "@bot/core-contracts/run-control"

const ADMIN = TgId.make(1)
const USER = TgId.make(2)

const fakeSql = (): SqlStorageLike => {
  const db = new DatabaseSync(":memory:")
  return {
    exec: (query, ...bindings) => {
      const stmt = db.prepare(query)
      const rows = /^\s*select/i.test(query) ? (stmt.all(...bindings) as Array<unknown>) : (stmt.run(...bindings), [])
      return { toArray: () => rows }
    }
  }
}

const textUpdate = (from: number, text: string, extra: Record<string, unknown> = {}): Update =>
  ({
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: from, is_bot: false, first_name: "x", language_code: "en" },
      date: 0,
      chat: { id: from, type: "private" },
      text,
      ...(text.startsWith("/")
        ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] }
        : {}),
      ...extra
    }
  }) as Update

const setup = (opts: { events?: ReadonlyArray<AgentEvent>; gate?: Deferred.Deferred<void> } = {}) => {
  const sent: Array<string> = []
  const docs: Array<string> = []
  const notified: Array<string> = []
  const presented: Array<string> = []
  const commands: ReadonlyArray<CommandDef> = [
    { name: "ping", role: "user", description: { en: "Ping", ru: "Пинг" }, handler: () => Effect.sync(() => void sent.push("pong")) }
  ]
  const registry = makeRegistry(commands, [])
  const { dispatch } = makeDispatcher({
    registry,
    present: ({ stream }) =>
      Effect.gen(function* () {
        if (opts.gate) yield* Deferred.await(opts.gate)
        yield* Stream.runForEach(stream, (e) => Effect.sync(() => void presented.push(e._tag)))
      })
  })
  const events = opts.events ?? [
    AgentEvent.SessionStarted({ sessionId: ClaudeSessionId.make("s1"), model: "m" }),
    AgentEvent.FileProduced({ path: "/workspace/a.txt", fileName: "a.txt" }),
    AgentEvent.Completed({
      sessionId: ClaudeSessionId.make("s1"),
      text: "ok",
      isError: false,
      costUsd: 0.1,
      inputTokens: 1,
      outputTokens: 2,
      durationMs: 3,
      numTurns: 1
    })
  ]
  const telegram = Telegram.of({
    sendMessage: (_to: unknown, html: string) => Effect.sync(() => (sent.push(html), { messageId: 1 })),
    sendDocument: (_to: unknown, f: { fileName: string }) => Effect.sync(() => (docs.push(f.fileName), { messageId: 2 })),
    answerCallbackQuery: () => Effect.void
  } as unknown as Telegram["Service"])
  const env = Layer.mergeAll(
    Layer.succeed(Telegram, telegram),
    Layer.succeed(Allowlist, {
      adminId: ADMIN,
      roleOf: (id: TgId) => Effect.succeed(id === ADMIN ? ("admin" as const) : id === USER ? ("user" as const) : undefined)
    } as unknown as Allowlist["Service"]),
    Layer.succeed(AgentRunner, {
      run: () => Stream.fromIterable(events),
      readFile: () => Effect.succeed(new Uint8Array([1]))
    } as unknown as AgentRunner["Service"]),
    Layer.succeed(AdminNotifier, { notify: (m: string) => Effect.sync(() => void notified.push(m)) }),
    Layer.succeed(McpAccess, { issue: () => Effect.succeed(undefined) }),
    runControlLayer,
    sessionsLayer(fakeSql()).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))))
  )
  const run = <A, E>(e: Effect.Effect<A, E, any>) => e.pipe(Effect.provide(env)) as Effect.Effect<A, E>
  return { dispatch, run, sent, docs, notified, presented }
}

describe("dispatcher", () => {
  it("ignores unknown senders silently", async () => {
    const t = setup()
    await Effect.runPromise(t.run(t.dispatch(textUpdate(99, "hello"))))
    expect(t.sent).toEqual([])
    expect(t.presented).toEqual([])
  })

  it("routes commands and answers unknown ones", async () => {
    const t = setup()
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "/ping"))))
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "/nope"))))
    expect(t.sent[0]).toBe("pong")
    expect(t.sent[1]).toContain("Unknown command")
  })

  it("runs the agent, stores the session, sends produced files", async () => {
    const t = setup()
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          yield* t.dispatch(textUpdate(USER, "hi"))
          const s = yield* Sessions
          const rec = yield* s.get("main" as never)
          expect(rec?.claudeSessionId).toBe("s1")
          expect(rec?.runs).toBe(1)
          expect((yield* s.usage).runsToday).toBe(1)
        })
      )
    )
    expect(t.presented).toEqual(["SessionStarted", "FileProduced", "Completed"])
    expect(t.docs).toEqual(["a.txt"])
  })

  it("rejects a concurrent run as busy and /stop-style interruption frees the slot", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const t = setup({ gate })
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(t.dispatch(textUpdate(USER, "one")))
          yield* Effect.sleep("20 millis")
          yield* t.dispatch(textUpdate(USER, "two"))
          expect(t.sent.some((m) => m.includes("/stop"))).toBe(true)
          const control = yield* RunControl
          expect(yield* control.stop("main" as never)).toBe(true)
          yield* Fiber.await(first)
          expect(yield* control.stop("main" as never)).toBe(false)
          expect(t.presented).toEqual([])
        })
      )
    )
  })

  it("stopped_message_generation interrupts the run of that thread", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const t = setup({ gate })
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(t.dispatch(textUpdate(USER, "one")))
          yield* Effect.sleep("20 millis")
          yield* t.dispatch({
            update_id: 2,
            stopped_message_generation: { chat: { id: USER, type: "private" }, draft_id: 5 }
          } as Update)
          yield* Fiber.await(first)
          const control = yield* RunControl
          expect(yield* control.running).toEqual([])
        })
      )
    )
  })
})
