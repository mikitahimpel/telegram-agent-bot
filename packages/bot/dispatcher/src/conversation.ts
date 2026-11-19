import { Config, Effect } from "effect"

export const DEFAULT_IDLE_RESET_HOURS = 6

export const idleResetHours = Config.Int("CONVERSATION_IDLE_RESET_HOURS").pipe(
  Config.withDefault(DEFAULT_IDLE_RESET_HOURS)
)

export const isIdleExpired = (lastUsedAt: number, now: number, hours: number): boolean =>
  hours > 0 && now - lastUsedAt >= hours * 3_600_000

export const readIdleResetHours = idleResetHours.pipe(
  Effect.catch(() => Effect.succeed(DEFAULT_IDLE_RESET_HOURS))
)
