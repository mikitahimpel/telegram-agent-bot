import * as Alchemy from "alchemy"
import * as Output from "alchemy/Output"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Config, Effect, Layer } from "effect"
import { ChatId } from "@bot/core-contracts/ids"
import { TelegramWebhook, providers as telegramProviders } from "@bot/infra-telegram-webhook/telegram-webhook"
import { registry } from "./apps/gateway/src/registry.ts"

const GATEWAY_MAIN = `${import.meta.dirname}/apps/gateway/src/worker.ts`
const CAR_WEB_DIST = `${import.meta.dirname}/apps/car-web/dist`
const RUNNER_CONTEXT = `${import.meta.dirname}/apps/claude-runner`

export default Alchemy.Stack(
  "TelegramAgentBot",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), telegramProviders()),
    state: Cloudflare.state()
  },
  Effect.gen(function* () {
    const stack = yield* Alchemy.Stack

    const telegramBotToken = yield* Config.Redacted("TELEGRAM_BOT_TOKEN")
    const telegramWebhookSecret = yield* Config.Redacted("TELEGRAM_WEBHOOK_SECRET")
    const claudeAuthMode = yield* Config.Literals(["subscription", "api_key"], "CLAUDE_AUTH_MODE").pipe(
      Config.withDefault("subscription" as const)
    )
    const claudeCredential =
      claudeAuthMode === "api_key"
        ? { ANTHROPIC_API_KEY: yield* Config.Redacted("ANTHROPIC_API_KEY") }
        : { CLAUDE_CODE_OAUTH_TOKEN: yield* Config.Redacted("CLAUDE_CODE_OAUTH_TOKEN") }
    const mcpTokenSecret = yield* Config.Redacted("MCP_TOKEN_SECRET")

    const adminTgId = yield* Config.Int("ADMIN_TG_ID")
    const dailyRunLimit = yield* Config.Int("DAILY_RUN_LIMIT").pipe(Config.withDefault(50))
    const instanceType = yield* Config.String("CONTAINER_INSTANCE_TYPE").pipe(Config.withDefault("basic"))
    const carWebUrl = yield* Config.String("CAR_WEB_URL").pipe(Config.withDefault(""))
    const tokenIssuedAt = yield* Config.String("CLAUDE_TOKEN_ISSUED_AT").pipe(Config.withDefault(""))

    const data = Cloudflare.R2.Bucket("Data", {
      cors: [{ allowedMethods: ["GET", "PUT"], allowedOrigins: ["*"], allowedHeaders: ["*"] }]
    })
    const kv = Cloudflare.KV.Namespace("Kv")

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
      assets: {
        directory: CAR_WEB_DIST,
        base: "/car",
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/health", "/telegram/*", "/mcp", "/car/api/*"]
      },
      env: {
        USER_AGENT: Cloudflare.DurableObject("UserAgent", { containers: [runner] }),
        KV: kv,
        BACKUPS: data,
        R2_S3: Cloudflare.R2.S3Credentials(data, { access: "read-write" }),
        TELEGRAM_BOT_TOKEN: telegramBotToken,
        TELEGRAM_WEBHOOK_SECRET: telegramWebhookSecret,
        CLAUDE_AUTH_MODE: claudeAuthMode,
        ...claudeCredential,
        MCP_TOKEN_SECRET: mcpTokenSecret,
        ADMIN_TG_ID: String(adminTgId),
        DAILY_RUN_LIMIT: String(dailyRunLimit),
        CAR_WEB_URL: carWebUrl,
        CONTAINER_INSTANCE_TYPE: instanceType,
        CLAUDE_TOKEN_ISSUED_AT: claudeAuthMode === "api_key" ? "" : tokenIssuedAt
      }
    })

    const webhookUrl = Output.interpolate`${gateway.url}/telegram/webhook`

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
