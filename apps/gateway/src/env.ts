import type { UserAgent } from "./user-agent.ts"

export type Env = {
  readonly USER_AGENT: DurableObjectNamespace<UserAgent>
  readonly KV: KVNamespace
  readonly BACKUPS: R2Bucket
  readonly AI: Ai
  readonly R2_S3: string
  readonly TELEGRAM_BOT_TOKEN: string
  readonly TELEGRAM_WEBHOOK_SECRET: string
  readonly CLAUDE_AUTH_MODE?: string
  readonly CLAUDE_CODE_OAUTH_TOKEN?: string
  readonly ANTHROPIC_API_KEY?: string
  readonly MCP_TOKEN_SECRET: string
  readonly ADMIN_TG_ID: string
  readonly CAR_WEB_URL?: string
  readonly DAILY_RUN_LIMIT?: string
  readonly CONTAINER_INSTANCE_TYPE?: string
  readonly CLAUDE_TOKEN_ISSUED_AT?: string
}
