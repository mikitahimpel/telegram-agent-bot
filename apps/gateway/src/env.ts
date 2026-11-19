import type { UserAgent } from "./user-agent.ts"

/**
 * Bindings of the gateway Worker, declared in alchemy.run.ts. Strings coming from `Config`
 * (secrets and plain settings) arrive as plain strings.
 */
export interface Env {
  readonly USER_AGENT: DurableObjectNamespace<UserAgent>
  /** Allowlist (`allow:<id>`) and plugin flags (`plugins:<id>`). */
  readonly KV: KVNamespace
  /** Agent snapshots (`agents/<tgId>/`) and car data (`car/<tgId>/`). The name is fixed by DirectoryBackup (`binding`). */
  readonly BACKUPS: R2Bucket
  /** JSON `S3CredentialsValue` for the data bucket (car presigned URLs). */
  readonly R2_S3: string
  readonly TELEGRAM_BOT_TOKEN: string
  readonly TELEGRAM_WEBHOOK_SECRET: string
  readonly CLAUDE_AUTH_MODE?: string
  readonly CLAUDE_CODE_OAUTH_TOKEN?: string
  readonly ANTHROPIC_API_KEY?: string
  readonly MCP_TOKEN_SECRET: string
  readonly ADMIN_TG_ID: string
  /** Public Mini App/recorder URL (`https://host/car/`); derived from the request origin when empty. */
  readonly CAR_WEB_URL?: string
  readonly DAILY_RUN_LIMIT?: string
  readonly CONTAINER_INSTANCE_TYPE?: string
  readonly CLAUDE_TOKEN_ISSUED_AT?: string
}
