import { DurableObject } from "cloudflare:workers"
import { DirectoryBackup, type DirectoryBackupGatewayBinding } from "@cloudflare/sandbox"
import { Clock, Effect, Layer, ManagedRuntime } from "effect"
import { layer as runnerLayer, type RunnerDeps } from "@bot/agent-runner/runner"
import { layer as sessionsLayer } from "@bot/agent-sessions/sessions"
import { layer as allowlistLayer } from "@bot/bot-allowlist/allowlist"
import { layer as adminNotifierLayer, AdminNotifier } from "@bot/bot-dispatcher/admin-notifier"
import { McpAccess } from "@bot/bot-dispatcher/mcp-access"
import { layer as runControlLayer } from "@bot/bot-dispatcher/run-control"
import { AgentRunner } from "@bot/core-contracts/agent-runner"
import { Allowlist } from "@bot/core-contracts/allowlist"
import type { AgentInfo } from "@bot/core-contracts/agent-directory"
import { TgId, ChatId } from "@bot/core-contracts/ids"
import { RunControl } from "@bot/core-contracts/run-control"
import { Scheduler, type ScheduledJob } from "@bot/core-contracts/scheduler"
import { Sessions } from "@bot/core-contracts/sessions"
import { layerLocal as userMemoryLayer } from "@bot/bot-memory/user-memory"
import { layerLocal as userSchedulerLayer } from "@bot/bot-scheduler/user-scheduler"
import { Telegram } from "@bot/core-contracts/telegram"
import type { Fact, WriteResult } from "@bot/bot-memory/memory-store"
import { makeSqlite } from "@bot/bot-invites/sqlite"
import { Invites, InviteInvalid, type Invite, type InviteInvalidReason } from "@bot/core-contracts/invites"
import { layer as speechLayer, type AiLike } from "@bot/infra-speech/speech"
import { McpToken } from "@bot/plugins-registry/mcp-token"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { decodeUpdate } from "@bot/telegram-schema/schema"
import { localCarBackend, runCarOp } from "./car-backend.ts"
import { agentDirectoryLayer } from "./agent-directory.ts"
import { configLayer } from "./config.ts"
import type { Env } from "./env.ts"
import { invitesStubLayer } from "./invites-stub.ts"
import { dispatch } from "./dispatch.ts"
import { enabledJobHandlers } from "./jobs.ts"
import { userMemoryStore } from "./memory-store.ts"
import { userStore } from "./scheduler-store.ts"
import { localUserPrefs, readStoredLang } from "./user-prefs.ts"
import { pluginEnvironment } from "./layers.ts"
import { pluginRegistry, type PluginR } from "./plugins.ts"
import type { CoreR } from "@bot/bot-core-commands/core-commands"
import { helpRegistryLayer } from "./help-registry.ts"
import { daysLeft, healthMessages, parseIssuedAt, reminderStage } from "./token-expiry.ts"

export const RUNNER_IMAGE = "Runner"
const MCP_TOKEN_TTL_SECONDS = 2 * 60 * 60

export interface AgentInfoDto extends Omit<AgentInfo, "tgId"> {
  readonly tgId: number
}

export interface InviteDto {
  readonly code: string
  readonly createdBy: number
  readonly note: string | null
  readonly plugins: Array<string>
  readonly usesTotal: number
  readonly usesLeft: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly revoked: boolean
}

export interface RedemptionDto {
  readonly code: string
  readonly tgId: number
  readonly name: string | null
  readonly username: string | null
  readonly note: string | null
  readonly at: number
}

export interface RedeemedDto {
  readonly code: string
  readonly createdBy: number
  readonly note: string | null
  readonly plugins: Array<string>
  readonly redeemedAt: number
}

export interface RedeemResult {
  readonly value: RedeemedDto | null
  readonly reason: InviteInvalidReason | null
}

const inviteDto = (i: Invite): InviteDto => ({
  ...i,
  note: i.note ?? null,
  plugins: [...i.plugins]
})

const makeRuntime = (
  ctx: DurableObjectState,
  env: Env,
  tgId: number,
  origin: () => string,
  invites: Invites["Service"]
) => {
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
    pluginEnvironment(
      env,
      origin(),
      userSchedulerLayer(TgId.make(tgId), userStore(ctx).service),
      userMemoryLayer(TgId.make(tgId), userMemoryStore(ctx)),
      localUserPrefs(env, TgId.make(tgId), ctx.storage.sql),
      localCarBackend(ctx)
    ),
    Layer.succeed(Scheduler, userStore(ctx).service),
    allowlistLayer(env.KV),
    sessionsLayer(ctx.storage.sql),
    runnerLayer(deps),
    speechLayer(env.AI as unknown as AiLike),
    runControlLayer,
    tgId === Number(env.ADMIN_TG_ID) ? Layer.succeed(Invites, invites) : invitesStubLayer(env)
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
    helpRegistryLayer
  ).pipe(Layer.provideMerge(base), Layer.provide(configLayer(env, origin())))

  return ManagedRuntime.make(derived)
}

export class UserAgent extends DurableObject<Env> {
  #state: { readonly tgId: number; readonly runtime: ReturnType<typeof makeRuntime> } | undefined
  #origin = ""
  #invites: Invites["Service"] | undefined

  #invitesService(): Invites["Service"] {
    if (this.#invites === undefined) this.#invites = makeSqlite(this.ctx.storage.sql)
    return this.#invites
  }

  #runtime(tgId: number, origin?: string) {
    if (origin !== undefined && origin !== "") this.#origin = origin
    if (this.#state === undefined) {
      this.#state = { tgId, runtime: makeRuntime(this.ctx, this.env, tgId, () => this.#origin, this.#invitesService()) }
    }
    if (this.#state.tgId !== tgId) throw new Error(`UserAgent ${this.#state.tgId} received a call for ${tgId}`)
    return this.#state.runtime
  }

  async handleUpdate(tgId: number, raw: unknown, origin: string): Promise<void> {
    const runtime = this.#runtime(tgId, origin)
    void this.ctx.storage.put("tgId", tgId)
    await runtime.runPromise(
      decodeUpdate(raw).pipe(
        Effect.flatMap(dispatch),
        Effect.catchCause((cause) => Effect.logError("user-agent update failed", cause)),
        Effect.withSpan("user-agent.handleUpdate", { attributes: { tgId } })
      )
    )
  }

  async #rememberOwner(tgId: number): Promise<void> {
    await this.ctx.storage.put("tgId", tgId)
  }

  async scheduleJob(tgId: number, job: ScheduledJob): Promise<void> {
    await this.#rememberOwner(tgId)
    await Effect.runPromise(userStore(this.ctx).service.schedule(job))
  }

  async cancelJob(_tgId: number, id: string): Promise<void> {
    await Effect.runPromise(userStore(this.ctx).service.cancel(id))
  }

  async getJob(_tgId: number, id: string): Promise<ScheduledJob | undefined> {
    return Effect.runPromise(userStore(this.ctx).service.get(id))
  }

  async listJobs(_tgId: number, kind: string): Promise<Array<ScheduledJob>> {
    return [...(await Effect.runPromise(userStore(this.ctx).service.list(kind)))]
  }

  async car(tgId: number, op: string, args: Array<unknown>): Promise<unknown> {
    await this.#rememberOwner(tgId)
    return runCarOp(this.ctx, op, args)
  }

  async memoryList(): Promise<Array<Fact>> {
    return [...(await Effect.runPromise(userMemoryStore(this.ctx).list))]
  }

  async memoryRemember(text: string): Promise<WriteResult> {
    return Effect.runPromise(userMemoryStore(this.ctx).remember(text))
  }

  async memoryUpdate(id: number, text: string): Promise<WriteResult> {
    return Effect.runPromise(userMemoryStore(this.ctx).update(id, text))
  }

  async memoryForget(id: number): Promise<boolean> {
    return Effect.runPromise(userMemoryStore(this.ctx).forget(id))
  }

  async memoryForgetAll(): Promise<number> {
    return Effect.runPromise(userMemoryStore(this.ctx).forgetAll)
  }

  async memoryRender(): Promise<string> {
    return Effect.runPromise(userMemoryStore(this.ctx).render)
  }

  async storedLang(): Promise<"ru" | "en" | undefined> {
    return readStoredLang(this.ctx.storage.sql)
  }

  override async alarm(): Promise<void> {
    const tgId = await this.ctx.storage.get<number>("tgId")
    if (tgId === undefined) return
    const id = TgId.make(tgId)
    const store = userStore(this.ctx)
    await this.#runtime(tgId).runPromise(
      enabledJobHandlers(id).pipe(
        Effect.flatMap((handlers) => store.runDue(handlers, id)),
        Effect.catchCause((cause) => Effect.logError("user-agent alarm failed", cause)),
        Effect.withSpan("user-agent.alarm", { attributes: { tgId } })
      )
    )
  }

  async createInvite(input: {
    readonly createdBy: number
    readonly uses: number
    readonly ttlMs: number
    readonly plugins: Array<string>
    readonly note: string | null
  }): Promise<InviteDto> {
    const created = await Effect.runPromise(
      this.#invitesService().create({
        createdBy: TgId.make(input.createdBy),
        uses: input.uses,
        ttlMs: input.ttlMs,
        plugins: input.plugins,
        note: input.note ?? undefined
      })
    )
    return inviteDto(created)
  }

  async listInvites(): Promise<Array<InviteDto>> {
    return (await Effect.runPromise(this.#invitesService().list)).map(inviteDto)
  }

  async recentRedemptions(limit: number): Promise<Array<RedemptionDto>> {
    const rows = await Effect.runPromise(this.#invitesService().recentRedemptions(limit))
    return rows.map((r) => ({ ...r, name: r.name ?? null, username: r.username ?? null, note: r.note ?? null }))
  }

  async revokeInvite(code: string): Promise<boolean> {
    return Effect.runPromise(this.#invitesService().revoke(code))
  }

  async redeemInvite(
    code: string,
    tgId: number,
    who: { readonly name: string | null; readonly username: string | null }
  ): Promise<RedeemResult> {
    const result = await Effect.runPromise(
      this.#invitesService()
        .redeem(code, TgId.make(tgId), {
          ...(who.name === null ? {} : { name: who.name }),
          ...(who.username === null ? {} : { username: who.username })
        })
        .pipe(Effect.result)
    )
    if (result._tag === "Success") {
      const v = result.success
      return { value: { ...v, note: v.note ?? null, plugins: [...v.plugins] }, reason: null }
    }
    if (result.failure instanceof InviteInvalid) return { value: null, reason: result.failure.reason }
    throw result.failure
  }

  async adminLang(): Promise<"ru" | "en"> {
    try {
      const rows = this.ctx.storage.sql.exec("SELECT value FROM settings WHERE key = 'lang'").toArray()
      return rows[0]?.value === "ru" ? "ru" : "en"
    } catch {
      return "en"
    }
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
