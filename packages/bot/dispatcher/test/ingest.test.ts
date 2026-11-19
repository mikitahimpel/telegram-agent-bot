import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vite-plus/test"
import { ConfigProvider, Effect, Layer, Stream } from "effect"
import { makeRegistry } from "@bot/bot-commands/registry"
import { layer as sessionsLayer, type SqlStorageLike } from "@bot/agent-sessions/sessions"
import { AgentEvent } from "@bot/core-contracts/agent-event"
import { AgentRunner, type RunInput } from "@bot/core-contracts/agent-runner"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { ClaudeSessionId, TgId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import { SpeechFailed, layerTest as speechTest } from "@bot/infra-speech/speech"
import type { Update } from "@bot/telegram-schema/schema"
import { AdminNotifier } from "../src/admin-notifier.ts"
import { makeDispatcher } from "../src/dispatcher.ts"
import { largestPhoto, quoteOf, truncateQuote } from "../src/ingest.ts"
import { McpAccess } from "../src/mcp-access.ts"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import { UserMemory } from "@bot/bot-memory/user-memory"
import type { MemoryStore } from "@bot/bot-memory/memory-store"
import { layer as runControlLayer } from "../src/run-control.ts"

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

const upd = (extra: Record<string, unknown>, id = 10): Update =>
  ({
    update_id: id,
    message: {
      message_id: id,
      from: { id: USER, is_bot: false, first_name: "x", language_code: "ru" },
      date: 0,
      chat: { id: USER, type: "private" },
      ...extra
    }
  }) as Update

const setup = (opts: { transcript?: string; sizes?: Record<string, number>; onDocument?: boolean } = {}) => {
  const sent: Array<string> = []
  const runs: Array<RunInput> = []
  const presented: Array<AgentEvent> = []
  const downloads: Array<string> = []
  const { dispatch } = makeDispatcher({
    registry: makeRegistry([], []),
    present: ({ stream }) => Stream.runForEach(stream, (e) => Effect.sync(() => void presented.push(e))),
    albumWindow: "20 millis",
    ...(opts.onDocument === true
      ? {
          onDocument: ({ document }: { document: { file_name?: string | undefined } }) =>
            Effect.succeed(document.file_name === "trip.csv")
        }
      : {})
  })
  const completed = AgentEvent.Completed({
    sessionId: ClaudeSessionId.make("s1"),
    text: "ok",
    isError: false,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    numTurns: 1
  })
  const telegram = {
    sendMessage: (_t: unknown, html: string) => Effect.sync(() => (sent.push(html), { messageId: 1 })),
    getFile: (id: string) => Effect.succeed({ filePath: `p/${id}`, fileSize: opts.sizes?.[id] }),
    downloadFile: (path: string) => Effect.sync(() => (downloads.push(path), new Uint8Array([1, 2]))),
    sendDocument: () => Effect.succeed({ messageId: 2 })
  } as unknown as Telegram["Service"]
  const env = Layer.mergeAll(
    Layer.succeed(Telegram, telegram),
    Layer.succeed(Allowlist, {
      adminId: USER,
      roleOf: () => Effect.succeed("user" as const),
      updateProfile: () => Effect.void
    } as unknown as Allowlist["Service"]),
    Layer.succeed(AgentRunner, {
      run: (i: RunInput) => (runs.push(i), Stream.make(completed)),
      readFile: () => Effect.succeed(new Uint8Array())
    } as unknown as AgentRunner["Service"]),
    Layer.succeed(AdminNotifier, { notify: () => Effect.void }),
    Layer.succeed(McpAccess, { issue: () => Effect.succeed(undefined) }),
    Layer.succeed(UserPrefs, { timeZone: () => Effect.succeed(undefined), lang: () => Effect.succeed(undefined) }),
    Layer.succeed(UserMemory, {
      forUser: () => ({ render: Effect.succeed("MEMORY [0/2000 tokens]\n(empty)") }) as unknown as MemoryStore
    }),
    speechTest(() =>
      opts.transcript === "fail"
        ? Effect.fail(new SpeechFailed({ reason: "x" }))
        : Effect.succeed({ text: opts.transcript ?? "привет мир" })
    ),
    runControlLayer,
    sessionsLayer(fakeSql()).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))))
  )
  const run = (e: Effect.Effect<void, never, any>) =>
    Effect.runPromise(e.pipe(Effect.provide(env)) as Effect.Effect<void>)
  return { dispatch, run, sent, runs, presented, downloads }
}

const voice = { file_id: "v1", file_unique_id: "u", duration: 2, file_size: 100 }

describe("media ingestion", () => {
  it("transcribes a voice message and quotes it", async () => {
    const t = setup()
    await t.run(t.dispatch(upd({ voice })))
    expect(t.runs[0]?.prompt).toBe("привет мир")
    expect(t.runs[0]?.attachments).toBeUndefined()
    expect(t.presented[0]).toMatchObject({ _tag: "AssistantText", text: "🎙 «привет мир»" })
    expect(t.presented.at(-1)).toMatchObject({ _tag: "Completed", text: "🎙 «привет мир»\n\nok" })
  })

  it("answers friendly when transcription fails or is empty", async () => {
    for (const transcript of ["fail", ""] as const) {
      const t = setup({ transcript })
      await t.run(t.dispatch(upd({ voice })))
      expect(t.runs).toEqual([])
      expect(t.sent[0]).toContain("Не расслышал")
    }
  })

  it("refuses files over 20 MB without downloading", async () => {
    const t = setup()
    await t.run(t.dispatch(upd({ voice: { ...voice, file_size: 21 * 1024 * 1024 } })))
    expect(t.runs).toEqual([])
    expect(t.downloads).toEqual([])
    expect(t.sent[0]).toContain("20 МБ")
  })

  it("refuses when getFile reports a big size", async () => {
    const t = setup({ sizes: { d1: 25 * 1024 * 1024 } })
    await t.run(t.dispatch(upd({ document: { file_id: "d1", file_unique_id: "u", file_name: "a.zip" } })))
    expect(t.runs).toEqual([])
    expect(t.downloads).toEqual([])
    expect(t.sent).toHaveLength(1)
  })

  it("turns the largest photo into an attachment with caption as prompt", async () => {
    const t = setup()
    await t.run(
      t.dispatch(
        upd({
          caption: "что это?",
          photo: [
            { file_id: "small", file_unique_id: "s", width: 10, height: 10, file_size: 5 },
            { file_id: "big", file_unique_id: "b", width: 100, height: 100, file_size: 50 }
          ]
        })
      )
    )
    expect(t.downloads).toEqual(["p/big"])
    expect(t.runs[0]?.prompt).toBe("что это?")
    expect(t.runs[0]?.attachments?.[0]).toMatchObject({ mimeType: "image/jpeg", fileName: "photo-b.jpg" })
  })

  it("uses a default prompt for a captionless document", async () => {
    const t = setup()
    await t.run(
      t.dispatch(
        upd({ document: { file_id: "d", file_unique_id: "u", file_name: "r.pdf", mime_type: "application/pdf" } })
      )
    )
    expect(t.runs[0]?.prompt).toContain("Пользователь прислал файл")
    expect(t.runs[0]?.attachments?.[0]).toMatchObject({ fileName: "r.pdf", mimeType: "application/pdf" })
  })

  it("lets the document hook handle CSV and attaches others", async () => {
    const t = setup({ onDocument: true })
    await t.run(t.dispatch(upd({ document: { file_id: "c", file_unique_id: "u", file_name: "trip.csv" } })))
    expect(t.runs).toEqual([])
    await t.run(t.dispatch(upd({ document: { file_id: "d", file_unique_id: "u", file_name: "x.csv.txt" } })))
    expect(t.runs).toHaveLength(1)
  })

  it("collects an album into one run", async () => {
    const t = setup()
    const photo = (id: string) => [{ file_id: id, file_unique_id: id, width: 1, height: 1 }]
    await Promise.all([
      t.run(t.dispatch(upd({ photo: photo("a"), media_group_id: "g", caption: "альбом" }, 1))),
      t.run(t.dispatch(upd({ photo: photo("b"), media_group_id: "g" }, 2))),
      t.run(t.dispatch(upd({ photo: photo("c"), media_group_id: "g" }, 3)))
    ])
    expect(t.runs).toHaveLength(1)
    expect(t.runs[0]?.attachments).toHaveLength(3)
    expect(t.runs[0]?.prompt).toBe("альбом")
  })
})

describe("ingest helpers", () => {
  it("picks the largest photo and truncates quotes", () => {
    expect(largestPhoto([])).toBeUndefined()
    expect(
      largestPhoto([
        { file_id: "a", file_unique_id: "a", width: 5, height: 5 },
        { file_id: "b", file_unique_id: "b", width: 9, height: 9 }
      ])?.file_id
    ).toBe("b")
    expect(truncateQuote("x".repeat(400)).length).toBe(300)
    expect(quoteOf("hi")).toBe("🎙 «hi»")
  })
})
