import { Effect, Layer, ManagedRuntime } from "effect"
import { layer as allowlistLayer } from "@bot/bot-allowlist/allowlist"
import { redeemInviteStart } from "@bot/bot-invites/redeem-flow"
import { handleCarApi } from "@bot/car-server/api"
import { handleMcpRequest } from "@bot/plugins-registry/mcp-server"
import { configLayer } from "./config.ts"
import type { Env } from "./env.ts"
import { pluginEnvironment } from "./layers.ts"
import { invitesStubLayer } from "./invites-stub.ts"
import { pluginRegistry } from "./plugins.ts"
import { helpRegistryLayer } from "./help-registry.ts"
import { screenWebhook } from "./webhook.ts"

export { DirectoryBackupGateway } from "@cloudflare/sandbox"
export { UserAgent } from "./user-agent.ts"

// oxlint-disable-next-line typescript/no-explicit-any
const mcpRuntimes = new WeakMap<object, ManagedRuntime.ManagedRuntime<any, any>>()

const mcpRuntime = (env: Env) => {
  let rt = mcpRuntimes.get(env)
  if (rt === undefined) {
    rt = ManagedRuntime.make(Layer.provide(pluginEnvironment(env), configLayer(env)))
    mcpRuntimes.set(env, rt)
  }
  return rt
}

// oxlint-disable-next-line typescript/no-explicit-any
const carApiRuntimes = new WeakMap<object, ManagedRuntime.ManagedRuntime<any, any>>()

const carApiRuntime = (env: Env) => {
  let rt = carApiRuntimes.get(env)
  if (rt === undefined) {
    rt = ManagedRuntime.make(
      Layer.provide(Layer.mergeAll(pluginEnvironment(env), allowlistLayer(env.KV)), configLayer(env))
    )
    carApiRuntimes.set(env, rt)
  }
  return rt
}

// oxlint-disable-next-line typescript/no-explicit-any
const inviteRuntimes = new WeakMap<object, ManagedRuntime.ManagedRuntime<any, any>>()

const inviteRuntime = (env: Env) => {
  let rt = inviteRuntimes.get(env)
  if (rt === undefined) {
    rt = ManagedRuntime.make(
      Layer.provide(
        Layer.mergeAll(
          pluginEnvironment(env),
          allowlistLayer(env.KV),
          invitesStubLayer(env),
          Layer.provide(helpRegistryLayer, pluginEnvironment(env))
        ),
        configLayer(env)
      )
    )
    inviteRuntimes.set(env, rt)
  }
  return rt
}

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } })

const webhook = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const outcome = await Effect.runPromise(screenWebhook(request, env))
  switch (outcome._tag) {
    case "Forbidden":
      return text("forbidden", 403)
    case "Ignored":
      return text("ok", 200)
    case "Invite": {
      const { from, code } = outcome
      ctx.waitUntil(
        env.USER_AGENT.getByName(String(env.ADMIN_TG_ID))
          .adminLang()
          .catch(() => "en" as const)
          .then((adminLang) =>
            inviteRuntime(env).runPromise(
              redeemInviteStart({ from, code, adminLang }).pipe(
                Effect.catchCause((cause) => Effect.logError("invite redemption failed", cause)),
                Effect.withSpan("gateway.invite")
              )
            )
          )
          .catch((e: unknown) => console.error("invite redemption failed", e))
      )
      return text("ok", 200)
    }
    case "Forward": {
      const stub = env.USER_AGENT.getByName(String(outcome.tgId))
      const origin = new URL(request.url).origin
      ctx.waitUntil(
        stub.handleUpdate(outcome.tgId, outcome.raw, origin).catch((e: unknown) => console.error("handleUpdate failed", e))
      )
      return text("ok", 200)
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === "/health" && request.method === "GET") return Response.json({ ok: true })
    if (pathname === "/telegram/webhook" && request.method === "POST") return webhook(request, env, ctx)
    if (pathname === "/mcp") {
      return mcpRuntime(env).runPromise(handleMcpRequest(pluginRegistry)(request).pipe(Effect.withSpan("gateway.mcp")))
    }
    if (pathname.startsWith("/car/api/")) {
      return carApiRuntime(env).runPromise(handleCarApi(request).pipe(Effect.withSpan("gateway.car-api")))
    }
    return text("not found", 404)
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const adminId = Number(env.ADMIN_TG_ID)
    ctx.waitUntil(
      env.USER_AGENT.getByName(String(adminId))
        .healthcheck(adminId)
        .catch((e: unknown) => console.error("healthcheck failed", e))
    )
  }
} satisfies ExportedHandler<Env>
