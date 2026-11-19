import { Effect, Layer, ManagedRuntime } from "effect"
import { handleMcpRequest } from "@bot/plugins-registry/mcp-server"
import { configLayer } from "./config.ts"
import type { Env } from "./env.ts"
import { pluginEnvironment } from "./layers.ts"
import { pluginRegistry } from "./plugins.ts"
import { screenWebhook } from "./webhook.ts"

export { DirectoryBackupGateway } from "@cloudflare/sandbox"
export { UserAgent } from "./user-agent.ts"

const mcpRuntimes = new WeakMap<object, ManagedRuntime.ManagedRuntime<any, any>>()

const mcpRuntime = (env: Env) => {
  let rt = mcpRuntimes.get(env)
  if (rt === undefined) {
    rt = ManagedRuntime.make(Layer.provide(pluginEnvironment(env), configLayer(env)))
    mcpRuntimes.set(env, rt)
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
    return text("not found", 404)
  },

  /** Cron (every 6 hours): the admin's agent checks the claude CLI auth and the token expiry. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const adminId = Number(env.ADMIN_TG_ID)
    ctx.waitUntil(
      env.USER_AGENT.getByName(String(adminId))
        .healthcheck(adminId)
        .catch((e: unknown) => console.error("healthcheck failed", e))
    )
  }
} satisfies ExportedHandler<Env>
