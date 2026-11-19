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
import { Scheduler, type ScheduledJob } from "@bot/core-contracts/scheduler"
import { ApiCreditsExhausted, ContainerDown, StorageError, SubscriptionLimitReached } from "@bot/core-contracts/errors"
import type { RunInput } from "@bot/core-contracts/agent-runner"
import { Telegram } from "@bot/core-contracts/telegram"
import type { Update } from "@bot/telegram-schema/schema"
import { AdminNotifier } from "../src/admin-notifier.ts"
import { makeDispatcher } from "../src/dispatcher.ts"
import { McpAccess } from "../src/mcp-access.ts"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import { UserMemory } from "@bot/bot-memory/user-memory"
import type { MemoryStore } from "@bot/bot-memory/memory-store"
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

const completedEvents = (text: string) => [
  AgentEvent.SessionStarted({ sessionId: ClaudeSessionId.make("s1"), model: "m" }),
  AgentEvent.Completed({
    sessionId: ClaudeSessionId.make("s1"),
    text,
    isError: false,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    numTurns: 1
  })
]

const setup = (
  opts: {
    events?: ReadonlyArray<AgentEvent>
    gate?: Deferred.Deferred<void>
    timeZone?: string
    memory?: Effect.Effect<string, StorageError>
    run?: (input: RunInput, call: number) => Stream.Stream<AgentEvent, ContainerDown | SubscriptionLimitReached | ApiCreditsExhausted>
  } = {}
) => {
  const sql = fakeSql()
  const inputs: Array<RunInput> = []
  const reactions: Array<string> = []
  const roles: Array<string> = []
  const jobs = new Map<string, ScheduledJob>()
  const sent: Array<string> = []
  const docs: Array<string> = []
  const notified: Array<string> = []
  const presented: Array<string> = []
  const commands: ReadonlyArray<CommandDef> = [
    { name: "ping", role: "user", description: { en: "Ping", ru: "Пинг" }, handler: () => Effect.sync(() => void sent.push("pong")) }
  ]
  const registry = makeRegistry(commands, [])
  const { dispatch, jobs: handlers } = makeDispatcher({
    registry,
    retryDelay: "0 millis",
    present: ({ stream, role }) =>
      Effect.gen(function* () {
        roles.push(role)
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
    answerCallbackQuery: () => Effect.void,
    setMessageReaction: (_to: unknown, emoji: string) => Effect.sync(() => void reactions.push(emoji))
  } as unknown as Telegram["Service"])
  const env = Layer.mergeAll(
    Layer.succeed(Telegram, telegram),
    Layer.succeed(Allowlist, {
      adminId: ADMIN,
      roleOf: (id: TgId) => Effect.succeed(id === ADMIN ? ("admin" as const) : id === USER ? ("user" as const) : undefined),
      updateProfile: () => Effect.void
    } as unknown as Allowlist["Service"]),
    Layer.succeed(AgentRunner, {
      run: (input: RunInput) =>
        Stream.unwrap(
          Effect.sync(() => {
            inputs.push(input)
            return opts.run === undefined ? Stream.fromIterable(events) : opts.run(input, inputs.length)
          })
        ),
      readFile: () => Effect.succeed(new Uint8Array([1]))
    } as unknown as AgentRunner["Service"]),
    Layer.succeed(AdminNotifier, { notify: (m: string) => Effect.sync(() => void notified.push(m)) }),
    Layer.succeed(McpAccess, { issue: () => Effect.succeed(undefined) }),
    Layer.succeed(UserPrefs, { timeZone: () => Effect.succeed(opts.timeZone), lang: () => Effect.succeed(undefined) }),
    Layer.succeed(UserMemory, {
      forUser: () => ({ render: opts.memory ?? Effect.succeed("MEMORY [0/2000 tokens]\n(empty)") }) as unknown as MemoryStore
    }),
    Layer.succeed(Scheduler, {
      schedule: (job: ScheduledJob) => Effect.sync(() => void jobs.set(job.id, job)),
      cancel: (id: string) => Effect.sync(() => void jobs.delete(id)),
      get: (id: string) => Effect.sync(() => jobs.get(id)),
      list: (kind: string) => Effect.sync(() => [...jobs.values()].filter((j) => j.kind === kind))
    } as unknown as Scheduler["Service"]),
    runControlLayer,
    sessionsLayer(sql).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))))
  )
  const run = <A, E>(e: Effect.Effect<A, E, any>) => e.pipe(Effect.provide(env)) as Effect.Effect<A, E>
  return { dispatch, handlers, run, sent, docs, notified, presented, inputs, reactions, roles, jobs, sql }
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

  it("queues messages while busy, merges them into one run, and reacts", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const t = setup({ gate })
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(t.dispatch(textUpdate(USER, "one")))
          yield* Effect.sleep("20 millis")
          yield* t.dispatch(textUpdate(USER, "two"))
          yield* t.dispatch(textUpdate(USER, "three"))
          expect(t.reactions).toEqual(["✍", "✍"])
          expect(t.sent.some((m) => m.includes("/stop"))).toBe(false)
          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(first)
          expect(t.inputs.map((i) => i.prompt)).toEqual(["one", "two\n\nthree"])
        })
      )
    )
  })

  it("caps the queue at 5 and asks to wait", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const t = setup({ gate })
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(t.dispatch(textUpdate(USER, "0")))
          yield* Effect.sleep("20 millis")
          for (let n = 1; n <= 6; n++) yield* t.dispatch(textUpdate(USER, String(n)))
          expect(t.reactions.length).toBe(5)
          expect(t.sent).toEqual(["Please wait, I'm still answering."])
          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(first)
          expect(t.inputs[1]?.prompt).toBe("1\n\n2\n\n3\n\n4\n\n5")
        })
      )
    )
  })

  it("stop clears the queue", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const t = setup({ gate })
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(t.dispatch(textUpdate(USER, "one")))
          yield* Effect.sleep("20 millis")
          yield* t.dispatch(textUpdate(USER, "two"))
          const control = yield* RunControl
          expect(yield* control.stop("main" as never)).toBe(true)
          yield* Fiber.await(first)
          expect(t.inputs.some((i) => i.prompt.includes("two"))).toBe(false)
        })
      )
    )
  })

  it("passes the role to the presenter", async () => {
    const t = setup()
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "hi"))))
    await Effect.runPromise(t.run(t.dispatch(textUpdate(ADMIN, "hi"))))
    expect(t.roles).toEqual(["user", "admin"])
  })

  it("the new topic button resets the conversation for users", async () => {
    const t = setup()
    await Effect.runPromise(
      t.run(
        Effect.gen(function* () {
          yield* t.dispatch(textUpdate(USER, "hi"))
          const s = yield* Sessions
          expect((yield* s.get("main" as never))?.claudeSessionId).toBe("s1")
          yield* t.dispatch(textUpdate(USER, "🆕 New topic"))
          expect((yield* s.get("main" as never))?.claudeSessionId).toBeUndefined()
        })
      )
    )
    expect(t.sent.at(-1)).toContain("start fresh")
    expect(t.inputs.length).toBe(1)
  })

  it.each([
    [USER, undefined],
    [ADMIN, "s1"]
  ])("after the idle window sender %s resumes %s", async (who, expected) => {
    const t = setup()
    await Effect.runPromise(t.run(t.dispatch(textUpdate(who, "hi"))))
    t.sql.exec("UPDATE sessions SET last_used_at = 0")
    await Effect.runPromise(t.run(t.dispatch(textUpdate(who, "again"))))
    expect(t.inputs[0]?.resume).toBeUndefined()
    expect(t.inputs[1]?.resume).toBe(expected)
  })

  it("keeps the session within the idle window", async () => {
    const t = setup()
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "hi"))))
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "again"))))
    expect(t.inputs[1]?.resume).toBe("s1")
  })

  it("passes the rendered memory block to every run and survives a failing store", async () => {
    const t = setup({ memory: Effect.succeed("MEMORY [3/2000 tokens]\n[1] Name is Mikita") })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "hi"))))
    expect(t.inputs[0]?.memory).toBe("MEMORY [3/2000 tokens]\n[1] Name is Mikita")
    const broken = setup({ memory: Effect.fail(new StorageError({ operation: "memory.list", cause: new Error("x") })) })
    await Effect.runPromise(broken.run(broken.dispatch(textUpdate(USER, "hi"))))
    expect(broken.inputs[0]).toBeDefined()
    expect(broken.inputs[0]?.memory).toBeUndefined()
  })

  it("shows the deferred-run time in the user's timezone", async () => {
    const resetsAt = Date.UTC(2026, 10, 19, 12, 0)
    const t = setup({ timeZone: "Europe/Warsaw", run: () => Stream.fail(new SubscriptionLimitReached({ resetsAt })) })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "first"))))
    expect(t.sent[0]).toMatch(/at about .*\d{2}:\d{2}\.$/)
    expect(t.sent[0]).not.toContain("UTC")
  })

  it("defers the run when the usage limit is hit and merges the pending prompt", async () => {
    const resetsAt = Date.now() + 3 * 3_600_000
    const t = setup({ run: () => Stream.fail(new SubscriptionLimitReached({ resetsAt })) })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "first"))))
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "second"))))
    expect(t.sent).toHaveLength(2)
    expect(t.sent[0]).toMatch(/I'll answer at about .*\d{2}:\d{2} UTC/)
    const jobsList = [...t.jobs.values()]
    expect(jobsList).toHaveLength(1)
    const job = jobsList[0]!
    expect(job.kind).toBe("deferred_run")
    expect(job.at).toBeGreaterThanOrEqual(resetsAt)
    expect(JSON.parse(job.payload)).toMatchObject({ tgId: USER, lang: "en", role: "user", prompt: "first\n\nsecond" })
  })

  it("the deferred_run handler reruns the stored prompt", async () => {
    const resetsAt = Date.now() + 3_600_000
    let limited = true
    const t = setup({
      run: () => (limited ? Stream.fail(new SubscriptionLimitReached({ resetsAt })) : Stream.fromIterable(completedEvents("late")))
    })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "question"))))
    const job = [...t.jobs.values()][0]!
    limited = false
    const handler = t.handlers.find((h) => h.kind === "deferred_run")!
    await Effect.runPromise(t.run(handler.run(job, { tgId: USER, now: job.at })))
    expect(t.inputs.at(-1)?.prompt).toBe("question")
    expect(t.presented).toContain("Completed")
  })

  it("explains an exhausted API budget plainly and alerts the admin", async () => {
    const t = setup({ run: () => Stream.fail(new ApiCreditsExhausted()) })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "hi"))))
    expect(t.sent).toEqual(["I can't answer right now, we're already fixing it. Please try again later."])
    expect(t.notified).toHaveLength(1)
    expect(t.notified[0]).toContain("credits")
  })

  it("retries once on a transient failure and succeeds", async () => {
    const t = setup({
      run: (_i, call) =>
        call === 1 ? Stream.fail(new ContainerDown({ reason: "boom" })) : Stream.fromIterable(completedEvents("ok"))
    })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "hi"))))
    expect(t.inputs).toHaveLength(2)
    expect(t.sent).toEqual([])
    expect(t.notified).toEqual([])
  })

  it("retries a run that ends silently, then tells the user and the admin", async () => {
    const t = setup({ run: () => Stream.fail(new ContainerDown({ reason: "dead" })) })
    await Effect.runPromise(t.run(t.dispatch(textUpdate(USER, "hi"))))
    expect(t.inputs).toHaveLength(2)
    expect(t.sent).toEqual(["Something went wrong, please try again a bit later."])
    expect(t.notified[0]).toContain("dead")
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
