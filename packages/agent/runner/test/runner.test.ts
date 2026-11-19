import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Option, Stream } from "effect"
import { AgentRunner, type RunInput } from "@bot/core-contracts/agent-runner"
import { ClaudeSessionId, SessionKey, TgId } from "@bot/core-contracts/ids"
import { ContainerDown, SubscriptionLimitReached } from "@bot/core-contracts/errors"
import { layer, buildClaudeArgv, ClaudeAuthConfig } from "../src/runner.ts"
import type { ContainerLike } from "../src/container-like.ts"
import { makeFake, type FakeOptions } from "./fake-container.ts"

const TOKEN = "sk-ant-oat01-SECRET-TOKEN"
const SID = "11111111-2222-3333-4444-555555555555"
const j = (o: unknown) => JSON.stringify(o)
const init = j({ type: "system", subtype: "init", session_id: SID, model: "m" })
const delta = j({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } })
const result = (extra: object = {}) =>
  j({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: SID, num_turns: 1, total_cost_usd: 0.01, duration_ms: 5, usage: { input_tokens: 1, output_tokens: 2 }, ...extra })

const tgId = TgId.make(42)
const input = (extra: Partial<RunInput> = {}): RunInput => ({
  tgId, sessionKey: SessionKey.make("main"), resume: undefined, prompt: "hello", lang: "ru", mcp: undefined, ...extra
})

const setup = (o: FakeOptions, env: Record<string, string> = {}) => {
  const fake = makeFake(o)
  const config = ConfigProvider.layer(ConfigProvider.fromEnvRecord({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, ...env }))
  const l = layer({ container: fake.container, backup: fake.backup, bucket: fake.bucket }).pipe(Layer.provide(config))
  return { fake, l }
}

const collect = (i: RunInput) => AgentRunner.use((r) => Stream.runCollect(r.run(i)))

describe("AgentRunner", () => {
  it.effect("starts, runs, emits events, FileProduced before Completed, then snapshots", () => {
    const { fake, l } = setup({
      claudeLines: [init, delta, result()],
      findOutputs: ["", "/workspace/out/chart.png\t1700000000.0\t10\n"]
    })
    return Effect.gen(function* () {
      const evs = yield* collect(input())
      expect(evs.map((e) => e._tag)).toEqual(["SessionStarted", "TextDelta", "FileProduced", "Completed"])
      expect(evs[2]).toMatchObject({ path: "/workspace/out/chart.png", fileName: "chart.png" })
      expect(fake.events).toContain("start")
      expect(fake.events.filter((e) => e.startsWith("backup:"))).toEqual(["backup:/home/node/.claude", "backup:/workspace"])
      expect(fake.store.has("agents/42/backup.json")).toBe(true)
    }).pipe(Effect.provide(l))
  })

  it.effect("restores once after start when an index exists; skips restore when already running", () => {
    const cold = setup({ claudeLines: [init, result()] })
    cold.fake.store.set("agents/42/backup.json", j({
      claude: { id: "o1", dir: "/home/node/.claude", size: 1, sha256: "x", format: "tar+zstd/1" },
      workspace: { id: "o2", dir: "/workspace", size: 1, sha256: "x", format: "tar+zstd/1" }
    }))
    const warm = setup({ claudeLines: [init, result()], startRunning: true })
    return Effect.gen(function* () {
      yield* collect(input()).pipe(Effect.provide(cold.l))
      expect(cold.fake.events.filter((e) => e.startsWith("restore:"))).toEqual(["restore:/home/node/.claude", "restore:/workspace"])
      yield* collect(input()).pipe(Effect.provide(warm.l))
      expect(warm.fake.events.some((e) => e.startsWith("restore:") || e === "start")).toBe(false)
    })
  })

  it.effect("token only in exec env, never argv; --resume and mcp via env var", () => {
    const { fake, l } = setup({ claudeLines: [init, result()] }, { CLAUDE_MODEL: "sonnet", AGENT_MAX_TURNS: "7" })
    return Effect.gen(function* () {
      yield* collect(input({ resume: ClaudeSessionId.make(SID), mcp: { url: "https://x/mcp", token: "MCP-SECRET" } }))
      const call = fake.execs.find((c) => c.cmd[0] === "claude" && c.cmd.includes("-p"))!
      const argv = call.cmd.join("\u0000")
      expect(argv).not.toContain(TOKEN)
      expect(argv).not.toContain("MCP-SECRET")
      expect(call.cmd[call.cmd.indexOf("--resume") + 1]).toBe(SID)
      expect(call.cmd[call.cmd.indexOf("--max-turns") + 1]).toBe("7")
      expect(call.cmd[call.cmd.indexOf("--model") + 1]).toBe("sonnet")
      expect(call.cmd).toContain("--strict-mcp-config")
      expect(call.cmd[call.cmd.indexOf("--mcp-config") + 1]).toContain("Bearer ${BOT_MCP_TOKEN}")
      expect(call.opts?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN)
      expect(call.opts?.env?.BOT_MCP_TOKEN).toBe("MCP-SECRET")
      expect(call.opts?.user).toBe("1000:1000")
      expect(call.opts?.cwd).toBe("/workspace")
      for (const c of fake.execs) if (c !== call) expect(c.opts?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    }).pipe(Effect.provide(l))
  })

  it.effect("api_key mode passes only ANTHROPIC_API_KEY to the claude run", () => {
    const { fake, l } = setup(
      { claudeLines: [init, result()] },
      { CLAUDE_AUTH_MODE: "api_key", ANTHROPIC_API_KEY: "sk-ant-api-SECRET", CLAUDE_CODE_OAUTH_TOKEN: "" }
    )
    return Effect.gen(function* () {
      yield* collect(input({}))
      const call = fake.execs.find((c) => c.cmd[0] === "claude" && c.cmd.includes("-p"))!
      expect(call.cmd.join("\u0000")).not.toContain("sk-ant-api-SECRET")
      expect(call.opts?.env?.ANTHROPIC_API_KEY).toBe("sk-ant-api-SECRET")
      expect(call.opts?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    }).pipe(Effect.provide(l))
  })

  it.effect("api_key mode without ANTHROPIC_API_KEY is a config error", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        ClaudeAuthConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ CLAUDE_AUTH_MODE: "api_key" }))))
      )
      expect(exit._tag).toBe("Failure")
    })
  )

  it("no --resume / mcp flags when not requested", () => {
    const argv = buildClaudeArgv(input({ prompt: "-rf" }), { maxTurns: 30, model: Option.none() })
    expect(argv).not.toContain("--resume")
    expect(argv).not.toContain("--mcp-config")
    expect(argv[2]).toBe(" -rf")
  })

  it.effect("interrupting the consumer kills the process and still snapshots", () => {
    const { fake, l } = setup({ claudeLines: [init], hang: true })
    return Effect.gen(function* () {
      const r = yield* AgentRunner
      const seen = yield* Deferred.make<void>()
      const fiber = yield* Effect.forkChild(Stream.runForEach(r.run(input()), () => Deferred.succeed(seen, undefined)))
      yield* Deferred.await(seen)
      yield* Fiber.interrupt(fiber)
      expect(fake.killed).toEqual([9])
      expect(fake.wasAborted()).toBe(true)
      expect(fake.execs.some((c) => c.cmd[0] === "pkill")).toBe(true)
      expect(fake.events.some((e) => e.startsWith("backup:"))).toBe(true)
    }).pipe(Effect.provide(l))
  })

  it.effect("usage limit -> SubscriptionLimitReached with resetsAt", () => {
    const { l } = setup({ claudeLines: [init, result({ is_error: true, result: "Claude AI usage limit reached|1900000000" })] })
    return Effect.gen(function* () {
      const e = yield* collect(input()).pipe(Effect.flip)
      expect(e).toBeInstanceOf(SubscriptionLimitReached)
      expect((e as SubscriptionLimitReached).resetsAt).toBe(1900000000_000)
    }).pipe(Effect.provide(l))
  })

  it.effect("non-zero exit without result -> ContainerDown with scrubbed stderr", () => {
    const { l } = setup({ claudeLines: [init], claudeExitCode: 2, claudeStderr: "boom" })
    return Effect.gen(function* () {
      const e = yield* collect(input()).pipe(Effect.flip)
      expect(e).toBeInstanceOf(ContainerDown)
      expect((e as ContainerDown).reason).toContain("code 2: boom")
    }).pipe(Effect.provide(l))
  })

  it.effect("snapshot failure does not fail the run", () => {
    const { l } = setup({ claudeLines: [init, result()], failBackup: true })
    return Effect.gen(function* () {
      const evs = yield* collect(input())
      expect(evs.at(-1)?._tag).toBe("Completed")
    }).pipe(Effect.provide(l))
  })

  it.effect("exec failure -> ContainerDown", () => {
    const fake = makeFake({ claudeLines: [], startRunning: true })
    const broken: ContainerLike = { ...fake.container, running: true, exec: async () => { throw new Error("gone") } }
    const l = layer({ container: broken, backup: fake.backup, bucket: fake.bucket }).pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN })))
    )
    return Effect.gen(function* () {
      const e = yield* collect(input()).pipe(Effect.flip)
      expect(e).toBeInstanceOf(ContainerDown)
    }).pipe(Effect.provide(l))
  })

  it.effect("inactivity timeout: default 10m, overridable", () => {
    const d = setup({ claudeLines: [init, result()] })
    const o = setup({ claudeLines: [init, result()] }, { AGENT_INACTIVITY_TIMEOUT: "30m", CONTAINER_INSTANCE_TYPE: "standard-1" })
    return Effect.gen(function* () {
      yield* collect(input()).pipe(Effect.provide(d.l))
      expect(d.fake.events).toContain("timeout:600000")
      yield* collect(input()).pipe(Effect.provide(o.l))
      expect(o.fake.events).toContain("timeout:1800000")
    })
  })

  it.effect("health, readFile, destroy", () => {
    const { fake, l } = setup({ claudeLines: [], startRunning: true })
    return Effect.gen(function* () {
      const r = yield* AgentRunner
      expect(yield* r.health(tgId)).toEqual({ version: "2.1.328", authOk: true })
      expect(new TextDecoder().decode(yield* r.readFile(tgId, "out/a.txt"))).toBe("file-bytes")
      const bad = yield* r.readFile(tgId, "/etc/passwd").pipe(Effect.flip)
      expect(bad).toBeInstanceOf(ContainerDown)
      yield* r.destroy(tgId)
      expect(fake.events).toContain("destroy")
    }).pipe(Effect.provide(l))
  })
})
