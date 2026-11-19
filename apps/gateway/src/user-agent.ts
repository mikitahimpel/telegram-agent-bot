import { DurableObject } from "cloudflare:workers"
import { DirectoryBackup, type DirectoryBackupGatewayBinding } from "@cloudflare/sandbox"
import { Clock, Effect, Layer, ManagedRuntime } from "effect"
import { layer as runnerLayer, type RunnerDeps } from "@bot/agent-runner/runner"
import { layer as sessionsLayer } from "@bot/agent-sessions/sessions"
import { layer as allowlistLayer } from "@bot/bot-allowlist/allowlist"
import { HelpRegistry } from "@bot/bot-core-commands/help-registry"
import { layer as adminNotifierLayer, AdminNotifier } from "@bot/bot-dispatcher/admin-notifier"
import { makeDispatcher, type PresentRun } from "@bot/bot-dispatcher/dispatcher"
import { McpAccess } from "@bot/bot-dispatcher/mcp-access"
import { layer as runControlLayer } from "@bot/bot-dispatcher/run-control"
import { AgentRunner } from "@bot/core-contracts/agent-runner"
import { Allowlist } from "@bot/core-contracts/allowlist"
import type { AgentInfo } from "@bot/core-contracts/agent-directory"
import { TgId, ChatId } from "@bot/core-contracts/ids"
import { RunControl } from "@bot/core-contracts/run-control"
import { Sessions } from "@bot/core-contracts/sessions"
import { Telegram } from "@bot/core-contracts/telegram"
import { McpToken } from "@bot/plugins-registry/mcp-token"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { decodeUpdate } from "@bot/telegram-schema/schema"
import { presentRun } from "@bot/telegram-streaming/streaming"
import { agentDirectoryLayer } from "./agent-directory.ts"
import { configLayer } from "./config.ts"
import type { Env } from "./env.ts"
import { pluginEnvironment } from "./layers.ts"
import { pluginRegistry } from "./plugins.ts"
import { registry } from "./registry.ts"
import { daysLeft, healthMessages, parseIssuedAt, reminderStage } from "./token-expiry.ts"

/** Image key of the container declared in alchemy.run.ts (`Cloudflare.Container("Runner", ...)`). */
export const RUNNER_IMAGE = "Runner"
const MCP_TOKEN_TTL_SECONDS = 2 * 60 * 60

const present: PresentRun = ({ to, lang, stream }) =>
  presentRun(stream, to, { lang, draftId: 1 + Math.floor(Math.random() * 2_000_000_000) }).pipe(Effect.asVoid)

const { dispatch } = makeDispatcher({ registry, present })

export interface AgentInfoDto extends Omit<AgentInfo, "tgId"> {
  readonly tgId: number
}

const makeRuntime = (ctx: DurableObjectState, env: Env, tgId: number, origin: () => string) => {
  const container = ctx.container
  if (container === undefined) throw new Error("UserAgent has no container binding")
  const gateway = (ctx as unknown as { exports: { DirectoryBackupGateway: DirectoryBackupGatewayBinding } }).exports
    .DirectoryBackupGateway
  const deps: RunnerDeps = {
    container,
    backup: new DirectoryBackup(container, gateway, { binding: "BACKUPS", prefix: `agents/${tgId}/` }),
    bucket: env.BACKUPS,
    imageName: RUNNER_IMAGE
  }

  const base = Layer.mergeAll(
    pluginEnvironment(env),
    allowlistLayer(env.KV),
    sessionsLayer(ctx.storage.sql),
    runnerLayer(deps),
    runControlLayer
  )

  const mcpAccess = Layer.effect(
    McpAccess,
    Effect.gen(function* () {
      const tokens = yield* McpToken
      const flags = yield* PluginFlags
      return {
        issue: (id: TgId) =>
          pluginRegistry.toolsFor(id).pipe(
            Effect.provideService(PluginFlags, flags),
            Effect.flatMap((tools) =>
              tools.length === 0 || origin() === ""
                ? Effect.succeed(undefined)
                : tokens.sign(id, MCP_TOKEN_TTL_SECONDS).pipe(Effect.map((token) => ({ url: `${origin()}/mcp`, token })))
            ),
            Effect.catch(() => Effect.succeed(undefined))
          )
      }
    })
  )

  const derived = Layer.mergeAll(
    adminNotifierLayer(),
    agentDirectoryLayer(env),
    mcpAccess,
    Layer.succeed(HelpRegistry, registry)
  ).pipe(Layer.provideMerge(base), Layer.provide(configLayer(env)))

  return ManagedRuntime.make(derived)
}

export class UserAgent extends DurableObject<Env> {
  #state: { readonly tgId: number; readonly runtime: ReturnType<typeof makeRuntime> } | undefined
  #origin = ""

  #runtime(tgId: number, origin?: string) {
    if (origin !== undefined && origin !== "") this.#origin = origin
    if (this.#state === undefined) {
      this.#state = { tgId, runtime: makeRuntime(this.ctx, this.env, tgId, () => this.#origin) }
    }
    if (this.#state.tgId !== tgId) throw new Error(`UserAgent ${this.#state.tgId} received a call for ${tgId}`)
    return this.#state.runtime
  }

  /** Webhook entry: resolves when the whole agent run is finished, which keeps this DO alive. */
  async handleUpdate(tgId: number, raw: unknown, origin: string): Promise<void> {
    const runtime = this.#runtime(tgId, origin)
    await runtime.runPromise(
      decodeUpdate(raw).pipe(
        Effect.flatMap(dispatch),
        Effect.catchCause((cause) => Effect.logError("user-agent update failed", cause)),
        Effect.withSpan("user-agent.handleUpdate", { attributes: { tgId } })
      )
    )
  }

  async info(tgId: number): Promise<AgentInfoDto> {
    return this.#runtime(tgId).runPromise(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const control = yield* RunControl
        const list = yield* sessions.list
        const running = yield* control.running
        return { tgId, sessions: list.length, running: running.length, usage: yield* sessions.usage }
      })
    )
  }

  /** Stops runs and destroys the container; it is recreated and restored from R2 on the next message. */
  async kill(tgId: number): Promise<void> {
    await this.#runtime(tgId).runPromise(
      Effect.gen(function* () {
        yield* (yield* RunControl).stopAll
        yield* (yield* AgentRunner).destroy(TgId.make(tgId))
      })
    )
  }

  async restart(tgId: number): Promise<void> {
    await this.#runtime(tgId).runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner
        yield* (yield* RunControl).stopAll
        yield* runner.snapshot(TgId.make(tgId)).pipe(Effect.ignore)
        yield* runner.destroy(TgId.make(tgId))
      })
    )
  }

  /**
   * Cron entry (admin's DO): checks the claude CLI auth and reminds about the token expiry
   * (30/7/1 days before, once per stage).
   */
  async healthcheck(tgId: number): Promise<void> {
    const storage = this.ctx.storage
    const issuedAt = parseIssuedAt(this.env.CLAUDE_TOKEN_ISSUED_AT)
    await this.#runtime(tgId).runPromise(
      Effect.gen(function* () {
        const tg = yield* Telegram
        const runner = yield* AgentRunner
        const sessions = yield* Sessions
        const lang = (yield* sessions.getLang) ?? "en"
        const m = healthMessages[lang]
        const to = { chatId: ChatId.make(tgId) }
        const alert = (html: string) => tg.sendMessage(to, html).pipe(Effect.ignore)

        const health = yield* runner.health(TgId.make(tgId)).pipe(Effect.result)
        if (health._tag === "Failure") yield* alert(m.containerFailed(health.failure.reason))
        else if (!health.success.authOk) yield* alert(m.authFailed)

        if (issuedAt === undefined) return
        const now = yield* Clock.currentTimeMillis
        const days = daysLeft(issuedAt, now)
        const stage = reminderStage(days)
        const last = yield* Effect.promise(() => storage.get<number>("tokenReminderStage"))
        if (stage === undefined) {
          if (last !== undefined) yield* Effect.promise(() => storage.delete("tokenReminderStage"))
          return
        }
        if (last === stage) return
        yield* alert(stage === 0 ? m.tokenExpired : m.tokenExpiring(days))
        yield* Effect.promise(() => storage.put("tokenReminderStage", stage))
      }).pipe(Effect.withSpan("user-agent.healthcheck"))
    )
  }
}
