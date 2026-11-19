import * as Alchemy from "alchemy"
import * as Output from "alchemy/Output"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Config, Effect, Layer } from "effect"
import { ChatId } from "@bot/core-contracts/ids"
import { TelegramWebhook, providers as telegramProviders } from "@bot/infra-telegram-webhook/telegram-webhook"
import { registry } from "./apps/gateway/src/registry.ts"

const GATEWAY_MAIN = `${import.meta.dirname}/apps/gateway/src/worker.ts`
const RUNNER_CONTEXT = `${import.meta.dirname}/apps/claude-runner`

export default Alchemy.Stack(
  "TelegramAgentBot",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), telegramProviders()),
    state: Cloudflare.state()
  },
  Effect.gen(function* () {
    const stack = yield* Alchemy.Stack

    // Secrets (values come from the environment; `pp run --env-file .env -- alchemy deploy`).
    const telegramBotToken = yield* Config.Redacted("TELEGRAM_BOT_TOKEN")
    const telegramWebhookSecret = yield* Config.Redacted("TELEGRAM_WEBHOOK_SECRET")
    const claudeOauthToken = yield* Config.Redacted("CLAUDE_CODE_OAUTH_TOKEN")
    const mcpTokenSecret = yield* Config.Redacted("MCP_TOKEN_SECRET")

    // Plain config (defaults are resolved here: `Config.withDefault` values are not bound to the Worker).
    const adminTgId = yield* Config.Int("ADMIN_TG_ID")
    const dailyRunLimit = yield* Config.Int("DAILY_RUN_LIMIT").pipe(Config.withDefault(50))
    const instanceType = yield* Config.String("CONTAINER_INSTANCE_TYPE").pipe(Config.withDefault("basic"))
    const tokenIssuedAt = yield* Config.String("CLAUDE_TOKEN_ISSUED_AT").pipe(Config.withDefault(""))

    // `agents/<tgId>/` snapshots of ~/.claude and `car/<tgId>/` data share one bucket.
    // Browsers upload car files with presigned PUTs, hence CORS.
    const data = Cloudflare.R2.Bucket("Data", {
      cors: [{ allowedMethods: ["GET", "PUT"], allowedOrigins: ["*"], allowedHeaders: ["*"] }]
    })
    // Allowlist (`allow:<id>`) and plugin flags (`plugins:<id>`).
    const kv = Cloudflare.KV.Namespace("Kv")

    // One image for the sandbox. The UserAgent Durable Object starts it itself (`ctx.container.start`),
    // choosing the instance type at runtime (CONTAINER_INSTANCE_TYPE). The container id is the image key
    // the DO reads from `ctx.container.images`.
    const runner = Cloudflare.Container("Runner", {
      schedulingPolicy: "durable_object",
      context: RUNNER_CONTEXT,
      build: { cache: true }
    })

    const gateway = yield* Cloudflare.Worker("Gateway", {
      main: GATEWAY_MAIN,
      compatibility: { date: "2026-11-19", flags: ["nodejs_compat"] },
      observability: { logs: { enabled: true, invocationLogs: true, persist: true } },
      crons: ["0 */6 * * *"],
      env: {
        USER_AGENT: Cloudflare.DurableObject("UserAgent", { containers: [runner] }),
        KV: kv,
        BACKUPS: data,
        R2_S3: Cloudflare.R2.S3Credentials(data, { access: "read-write" }),
        TELEGRAM_BOT_TOKEN: telegramBotToken,
        TELEGRAM_WEBHOOK_SECRET: telegramWebhookSecret,
        CLAUDE_CODE_OAUTH_TOKEN: claudeOauthToken,
        MCP_TOKEN_SECRET: mcpTokenSecret,
        ADMIN_TG_ID: String(adminTgId),
        DAILY_RUN_LIMIT: String(dailyRunLimit),
        CONTAINER_INSTANCE_TYPE: instanceType,
        CLAUDE_TOKEN_ISSUED_AT: tokenIssuedAt
      }
    })

    const webhookUrl = Output.interpolate`${gateway.url}/telegram/webhook`

    // A bot has exactly one webhook: only `dev` (own test bot) and `prod` register it; pr-* stages skip it.
    if (stack.stage === "dev" || stack.stage === "prod") {
      yield* TelegramWebhook("Webhook", {
        botToken: telegramBotToken,
        secretToken: telegramWebhookSecret,
        url: webhookUrl,
        menus: registry.menus(ChatId.make(adminTgId))
      })
    }

    return { stage: stack.stage, url: gateway.url, webhookUrl }
  })
)
