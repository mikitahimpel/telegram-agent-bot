import { defineMessages } from "@bot/core-contracts/lang"

export const TOKEN_LIFETIME_DAYS = 365
export const REMINDER_DAYS = [30, 7, 1] as const
const DAY_MS = 86_400_000

export const daysLeft = (issuedAtMs: number, nowMs: number): number =>
  Math.ceil((issuedAtMs + TOKEN_LIFETIME_DAYS * DAY_MS - nowMs) / DAY_MS)

export const reminderStage = (remainingDays: number): number | undefined => {
  if (remainingDays <= 0) return 0
  for (const d of [1, 7, 30]) if (remainingDays <= d) return d
  return undefined
}

export const parseIssuedAt = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw.trim() === "") return undefined
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? undefined : ms
}

export const healthMessages = defineMessages({
  en: {
    tokenExpiring: (days: number) =>
      `The Claude token expires in ${days} day(s). Run <code>claude setup-token</code>, update CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_TOKEN_ISSUED_AT, then redeploy.`,
    tokenExpired:
      "The Claude token has expired. Run <code>claude setup-token</code>, update CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_TOKEN_ISSUED_AT, then redeploy.",
    authFailed: "Healthcheck: the claude CLI is not authenticated. The token may be invalid or expired.",
    containerFailed: (reason: string) => `Healthcheck: the agent container is not working: ${reason}`
  },
  ru: {
    tokenExpiring: (days: number) =>
      `Токен Claude истекает через ${days} дн. Выполните <code>claude setup-token</code>, обновите CLAUDE_CODE_OAUTH_TOKEN и CLAUDE_TOKEN_ISSUED_AT и задеплойте заново.`,
    tokenExpired:
      "Токен Claude истёк. Выполните <code>claude setup-token</code>, обновите CLAUDE_CODE_OAUTH_TOKEN и CLAUDE_TOKEN_ISSUED_AT и задеплойте заново.",
    authFailed: "Healthcheck: claude CLI не авторизован. Возможно, токен недействителен или истёк.",
    containerFailed: (reason: string) => `Healthcheck: контейнер агента не работает: ${reason}`
  }
})
