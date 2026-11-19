import { Clock, Context, Effect, Layer } from "effect"
import { Allowlist } from "@bot/core-contracts/allowlist"
import type { ChatId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import { escapeHtml } from "@bot/bot-commands/html"

export class AdminNotifier extends Context.Service<
  AdminNotifier,
  { readonly notify: (message: string) => Effect.Effect<void> }
>()("@bot/AdminNotifier") {}

export type NotifierOptions = {
  readonly dedupeMs?: number
  readonly maxPerMinute?: number
}

const MAX_LENGTH = 600

export const layer = (options: NotifierOptions = {}): Layer.Layer<AdminNotifier, never, Telegram | Allowlist> =>
  Layer.effect(
    AdminNotifier,
    Effect.gen(function* () {
      const tg = yield* Telegram
      const { adminId } = yield* Allowlist
      const dedupeMs = options.dedupeMs ?? 10 * 60_000
      const maxPerMinute = options.maxPerMinute ?? 6
      const seen = new Map<string, number>()
      let windowStart = 0
      let windowCount = 0

      const notify = (message: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const text = message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH)}…` : message
          const last = seen.get(text)
          if (last !== undefined && now - last < dedupeMs) return
          if (now - windowStart >= 60_000) {
            windowStart = now
            windowCount = 0
          }
          if (windowCount >= maxPerMinute) return
          windowCount++
          seen.set(text, now)
          if (seen.size > 200) for (const [k, at] of seen) if (now - at >= dedupeMs) seen.delete(k)
          yield* tg.sendMessage({ chatId: adminId as unknown as ChatId }, `Alert: ${escapeHtml(text)}`)
        }).pipe(Effect.ignore)

      return { notify }
    })
  )

export const layerNoop: Layer.Layer<AdminNotifier> = Layer.succeed(AdminNotifier, { notify: () => Effect.void })
