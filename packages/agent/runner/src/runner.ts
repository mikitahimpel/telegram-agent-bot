import { Config, ConfigProvider, Duration, Effect, Layer, Option, Redacted, Schedule, Schema, Semaphore, Stream } from "effect"
import { AgentRunner, type RunInput } from "@bot/core-contracts/agent-runner"
import { AgentEvent } from "@bot/core-contracts/agent-event"
import { type ApiCreditsExhausted, ContainerDown, type SubscriptionLimitReached } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import { splitLines } from "@bot/agent-stream-json/split-lines"
import { toAgentEvents } from "@bot/agent-stream-json/stream-json"
import type { ContainerLike, DirectoryBackupLike, DirectoryBackupRecord, ExecProcessLike, R2Like } from "./container-like.ts"

export interface RunnerDeps {
  readonly container: ContainerLike
  readonly backup: DirectoryBackupLike
  readonly bucket: R2Like
  readonly imageName?: string
  readonly user?: string
  readonly home?: string
}

const WORKSPACE = "/workspace"
const OUT_DIR = "/workspace/out"
const PATH_ENV = "/usr/local/bin:/usr/bin:/bin"
const SIGTERM = 15

const BASE_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch"]
const MCP_SERVER = "bot"

const systemPrompt = (lang: Lang): string =>
  [
    "You are a personal assistant running inside a Telegram bot, with a Linux sandbox at /workspace.",
    "Reply in the language of the user's message (Russian or English); if unsure, use " +
      (lang === "ru" ? "Russian" : "English") + ".",
    "Be concise: the answer is read on a phone.",
    "Any file the user should receive (charts, tables, exports, documents) MUST be saved in /workspace/out/ — files elsewhere are not delivered."
  ].join(" ")

export const INSTANCE_TYPES = ["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"] as const
export type InstanceType = (typeof INSTANCE_TYPES)[number]

export type ClaudeAuth =
  | { readonly mode: "subscription"; readonly token: Redacted.Redacted<string> }
  | { readonly mode: "api_key"; readonly apiKey: Redacted.Redacted<string> }

export const CLAUDE_AUTH_MODES = ["subscription", "api_key"] as const

export const ClaudeAuthConfig: Config.Config<ClaudeAuth> = Config.Literals(CLAUDE_AUTH_MODES, "CLAUDE_AUTH_MODE").pipe(
  Config.withDefault("subscription" as const),
  Config.flatMap((mode): Config.Config<ClaudeAuth> =>
    mode === "api_key"
      ? Config.map(Config.Redacted("ANTHROPIC_API_KEY"), (apiKey) => ({ mode, apiKey }))
      : Config.map(Config.Redacted("CLAUDE_CODE_OAUTH_TOKEN"), (token) => ({ mode, token }))
  )
)

export const authEnv = (auth: ClaudeAuth): Record<string, string> =>
  auth.mode === "api_key"
    ? { ANTHROPIC_API_KEY: Redacted.value(auth.apiKey) }
    : { CLAUDE_CODE_OAUTH_TOKEN: Redacted.value(auth.token) }

export interface RunnerConfig {
  readonly auth: ClaudeAuth
  readonly model: Option.Option<string>
  readonly instanceType: InstanceType
  readonly maxTurns: number
  readonly inactivityTimeout: Duration.Duration
}

const parseDuration = (raw: string): Option.Option<Duration.Duration> => {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(raw.trim())
  if (m !== null) {
    const n = Number(m[1])
    return Option.some(
      m[2] === "ms" ? Duration.millis(n) : m[2] === "s" ? Duration.seconds(n) : m[2] === "m" ? Duration.minutes(n) : Duration.hours(n)
    )
  }
  return Duration.fromInput(raw as Duration.Input)
}

export const RunnerConfig = Config.all({
  auth: ClaudeAuthConfig,
  model: Config.option(Config.String("CLAUDE_MODEL")),
  instanceType: Config.Literals(INSTANCE_TYPES, "CONTAINER_INSTANCE_TYPE").pipe(Config.withDefault("basic" as InstanceType)),
  maxTurns: Config.Int("AGENT_MAX_TURNS").pipe(Config.withDefault(30)),
  inactivityTimeout: Config.String("AGENT_INACTIVITY_TIMEOUT").pipe(
    Config.withDefault("10m"),
    Config.flatMap((raw) =>
      Option.match(parseDuration(raw), {
        onSome: (d) => Config.succeed(d),
        onNone: () => Config.fail(new ConfigProvider.SourceError({ message: "AGENT_INACTIVITY_TIMEOUT: expected a duration like 10m, 90s, 2h or \"10 minutes\"" }))
      })
    )
  )
})

export const buildClaudeArgv = (input: RunInput, cfg: { readonly maxTurns: number; readonly model: Option.Option<string> }): string[] => {
  const tools = input.mcp === undefined ? BASE_TOOLS : [...BASE_TOOLS, `mcp__${MCP_SERVER}`]
  const argv = [
    "claude",
    "-p",
    input.prompt.startsWith("-") ? ` ${input.prompt}` : input.prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode", "dontAsk",
    "--allowedTools", tools.join(","),
    "--max-turns", String(cfg.maxTurns),
    "--append-system-prompt", systemPrompt(input.lang)
  ]
  if (Option.isSome(cfg.model)) argv.push("--model", cfg.model.value)
  if (input.resume !== undefined) argv.push("--resume", input.resume)
  if (input.mcp !== undefined) {
    argv.push(
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER]: { type: "http", url: input.mcp.url, headers: { Authorization: "Bearer ${BOT_MCP_TOKEN}" } }
        }
      }),
      "--strict-mcp-config"
    )
  }
  return argv
}

const BackupIndex = Schema.Struct({
  claude: Schema.optional(Schema.Unknown),
  workspace: Schema.optional(Schema.Unknown)
})
interface Index {
  claude?: DirectoryBackupRecord
  workspace?: DirectoryBackupRecord
}

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const textOf = (b: ArrayBuffer) => new TextDecoder().decode(b)

export const make = (deps: RunnerDeps): Effect.Effect<AgentRunner["Service"], Config.ConfigError> =>
  Effect.gen(function* () {
    const cfg = yield* RunnerConfig
    const credentials = authEnv(cfg.auth)
    const { container, backup, bucket } = deps
    const user = deps.user ?? "1000:1000"
    const home = deps.home ?? "/home/node"
    const claudeDir = `${home}/.claude`
    const imageName = deps.imageName ?? "workspace"
    const inactivityMs = Duration.toMillis(cfg.inactivityTimeout)
    const lock = Semaphore.makeUnsafe(1)

    const secret = Object.values(credentials)[0] ?? ""
    const scrub = (s: string) => (secret.length > 0 ? s.split(secret).join("[redacted]") : s)
    const down = (reason: string, cause?: unknown) =>
      new ContainerDown({ reason: scrub(reason), ...(cause === undefined ? {} : { cause }) })
    const wrap = <A>(label: string, f: () => Promise<A>): Effect.Effect<A, ContainerDown> =>
      Effect.tryPromise({ try: f, catch: (e) => down(`${label}: ${errMessage(e)}`, e) })

    const sh = (cmd: string[], opts: { root?: boolean; env?: Record<string, string> } = {}) =>
      wrap(cmd[0] ?? "exec", async () => {
        const p = await container.exec(cmd, {
          cwd: WORKSPACE,
          ...(opts.root === true ? {} : { user }),
          env: { HOME: home, PATH: PATH_ENV, ...opts.env }
        })
        const out = await p.output()
        return { code: out.exitCode, stdout: textOf(out.stdout), stderr: textOf(out.stderr) }
      })

    const indexKey = (tgId: TgId) => `agents/${tgId}/backup.json`

    const readIndex = (tgId: TgId): Effect.Effect<Index, ContainerDown> =>
      wrap("read backup index", async () => {
        const obj = await bucket.get(indexKey(tgId))
        return obj === null ? null : await obj.text()
      }).pipe(
        Effect.map((raw): Index => {
          if (raw === null) return {}
          try {
            const parsed = Schema.decodeUnknownSync(BackupIndex)(JSON.parse(raw))
            return parsed as Index
          } catch {
            return {}
          }
        })
      )

    const waitReady = Effect.tryPromise({
      try: async () => {
        const p = await container.exec(["true"], { user })
        const code = await p.exitCode
        if (code !== 0) throw new Error(`exit ${code}`)
      },
      catch: (e) => down(`container not ready: ${errMessage(e)}`, e)
    }).pipe(Effect.retry({ times: 30, schedule: Schedule.spaced(Duration.seconds(1)) }))

    const restoreUnlocked = (tgId: TgId): Effect.Effect<void, ContainerDown> =>
      Effect.gen(function* () {
        const idx = yield* readIndex(tgId)
        if (idx.claude !== undefined) yield* wrap("restore ~/.claude", () => backup.restore(idx.claude!))
        if (idx.workspace !== undefined) yield* wrap("restore /workspace", () => backup.restore(idx.workspace!))
        yield* sh(["mkdir", "-p", OUT_DIR, claudeDir], { root: true })
        yield* sh(["chown", "-R", user, WORKSPACE, home], { root: true })
      })

    const touchTimeout = wrap("setInactivityTimeout", () => container.setInactivityTimeout(inactivityMs))

    const ensureStarted = (tgId: TgId): Effect.Effect<void, ContainerDown> =>
      lock.withPermit(
        Effect.gen(function* () {
          if (container.running) {
            yield* touchTimeout
            return
          }
          const image = container.images[imageName]
          if (image === undefined) return yield* Effect.fail(down(`unknown container image "${imageName}"`))
          yield* Effect.try({
            try: () =>
              container.start({
                image,
                instance: cfg.instanceType,
                enableInternet: true,
                env: { HOME: home },
                labels: { tgId: String(tgId) }
              }),
            catch: (e) => down(`start: ${errMessage(e)}`, e)
          })
          yield* touchTimeout
          yield* waitReady
          yield* restoreUnlocked(tgId)
        })
      )

    const snapshotUnlocked = (tgId: TgId): Effect.Effect<void, ContainerDown> =>
      Effect.gen(function* () {
        if (!container.running) return
        const old = yield* readIndex(tgId)
        const claude = yield* wrap("backup ~/.claude", () =>
          backup.backup({ dir: claudeDir, name: "claude-home", exclude: ["cache/**", "**/node_modules/**", "downloads/**"] })
        )
        const workspace = yield* wrap("backup /workspace", () =>
          backup.backup({ dir: WORKSPACE, name: "workspace", exclude: ["**/node_modules/**", "**/.cache/**"] })
        )
        yield* wrap("write backup index", () => bucket.put(indexKey(tgId), JSON.stringify({ claude, workspace })))
        for (const r of [old.claude, old.workspace]) {
          if (r !== undefined) {
            yield* wrap("delete old backup", () => backup.delete(r)).pipe(
              Effect.catch((e) => Effect.logWarning(`old backup cleanup failed: ${e.reason}`))
            )
          }
        }
      })

    const snapshot = (tgId: TgId) => lock.withPermit(snapshotUnlocked(tgId))

    const snapshotQuiet = (tgId: TgId) =>
      snapshot(tgId).pipe(Effect.catch((e) => Effect.logWarning(`snapshot failed: ${e.reason}`)))

    const listOut = Effect.gen(function* () {
      const r = yield* sh(["find", OUT_DIR, "-type", "f", "-printf", "%p\t%T@\t%s\n"])
      const m = new Map<string, string>()
      if (r.code !== 0) return m
      for (const line of r.stdout.split("\n")) {
        const [path, mtime, size] = line.split("\t")
        if (path !== undefined && mtime !== undefined && size !== undefined) m.set(path, `${mtime}:${size}`)
      }
      return m
    }).pipe(Effect.catch(() => Effect.succeed(new Map<string, string>())))

    const newFiles = (before: Map<string, string>) =>
      listOut.pipe(
        Effect.map((after) =>
          [...after.entries()]
            .filter(([p, sig]) => before.get(p) !== sig)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path]) => AgentEvent.FileProduced({ path, fileName: path.slice(path.lastIndexOf("/") + 1) }))
        )
      )

    const run = (input: RunInput): Stream.Stream<AgentEvent, ContainerDown | SubscriptionLimitReached | ApiCreditsExhausted> =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* ensureStarted(input.tgId)
          const before = yield* listOut
          const argv = buildClaudeArgv(input, cfg)
          const ac = new AbortController()
          let finished = false
          let sawCompleted = false

          const proc: ExecProcessLike = yield* Effect.acquireRelease(
            wrap("exec claude", () =>
              container.exec(argv, {
                cwd: WORKSPACE,
                user,
                signal: ac.signal,
                stdout: "pipe",
                stderr: "pipe",
                env: {
                  HOME: home,
                  PATH: PATH_ENV,
                  ...credentials,
                  ...(input.mcp === undefined ? {} : { BOT_MCP_TOKEN: input.mcp.token })
                }
              })
            ),
            (p) =>
              Effect.gen(function* () {
                if (!finished) {
                  yield* Effect.sync(() => {
                    try { p.kill(9) } catch {}
                    ac.abort()
                  })
                  yield* Effect.promise(() => Promise.race([p.exitCode.catch(() => 0), new Promise((r) => setTimeout(r, 3000))]))
                  yield* sh(["pkill", "-KILL", "-u", user.split(":")[0] ?? "1000"], { root: true }).pipe(Effect.ignore)
                }
                yield* snapshotQuiet(input.tgId)
              })
          )

          const stderrTail: Promise<string> =
            proc.stderr === null
              ? Promise.resolve("")
              : new Response(proc.stderr).text().then((t) => t.slice(-2000), () => "")

          const stdout = Stream.fromReadableStream({
            evaluate: () => proc.stdout as ReadableStream<Uint8Array>,
            onError: (e) => down(`stdout: ${errMessage(e)}`, e)
          })

          const events = toAgentEvents(splitLines(stdout)).pipe(
            Stream.flatMap((ev): Stream.Stream<AgentEvent> => {
              if (ev._tag !== "Completed") return Stream.make(ev)
              sawCompleted = true
              return Stream.unwrap(newFiles(before).pipe(Effect.map((files) => Stream.fromIterable([...files, ev]))))
            })
          )

          const tail = Stream.unwrap(
            Effect.gen(function* () {
              const code = yield* wrap("claude exit", () => proc.exitCode)
              finished = true
              if (!sawCompleted && code !== 0) {
                const err = yield* Effect.promise(() => stderrTail)
                return yield* Effect.fail(down(`claude exited with code ${code}: ${err.trim()}`))
              }
              return Stream.empty
            })
          )

          return Stream.concat(events, tail)
        })
      )

    return AgentRunner.of({
      run,
      restore: (tgId) =>
        lock.withPermit(
          Effect.gen(function* () {
            if (!container.running) return yield* Effect.fail(down("container is not running"))
            yield* restoreUnlocked(tgId)
          })
        ),
      snapshot,
      destroy: (tgId) =>
        lock.withPermit(
          wrap(`destroy ${tgId}`, async () => {
            if (container.running) await container.destroy()
          })
        ),
      readFile: (tgId, path) =>
        Effect.gen(function* () {
          const norm = path.startsWith("/") ? path : `${WORKSPACE}/${path}`
          if (norm.includes("..") || !(norm.startsWith(`${WORKSPACE}/`))) {
            return yield* Effect.fail(down(`path outside /workspace: ${path}`))
          }
          yield* ensureStarted(tgId)
          return yield* wrap(`read ${norm}`, async () => {
            const p = await container.exec(["cat", "--", norm], { user, stdout: "pipe", stderr: "pipe" })
            const out = await p.output()
            if (out.exitCode !== 0) throw new Error(`cat exited ${out.exitCode}: ${textOf(out.stderr).trim()}`)
            return new Uint8Array(out.stdout)
          })
        }),
      health: (tgId) =>
        Effect.gen(function* () {
          yield* ensureStarted(tgId)
          const v = yield* sh(["claude", "--version"])
          if (v.code !== 0) return yield* Effect.fail(down(`claude --version exited ${v.code}: ${v.stderr.trim()}`))
          const a = yield* sh(["claude", "auth", "status"], { env: credentials })
          let authOk = false
          try {
            const status = JSON.parse(a.stdout) as { loggedIn?: boolean; authMethod?: string }
            authOk = a.code === 0 && status.loggedIn === true && (cfg.auth.mode !== "api_key" || status.authMethod === "api_key")
          } catch {}
          return { version: v.stdout.trim().split(" ")[0] ?? v.stdout.trim(), authOk }
        })
    })
  })

export const layer = (deps: RunnerDeps): Layer.Layer<AgentRunner, Config.ConfigError> =>
  Layer.effect(AgentRunner, make(deps))
