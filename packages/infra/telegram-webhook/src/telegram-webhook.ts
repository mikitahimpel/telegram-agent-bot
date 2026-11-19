import { Resource } from "alchemy"
import * as Provider from "alchemy/Provider"
import { Data, Effect, Layer, Redacted } from "effect"

export const ALLOWED_UPDATES = ["message", "edited_message", "callback_query", "stopped_message_generation"] as const

/** One `setMyCommands` call; structurally equal to `MenuPayload` of @bot/bot-commands/registry. */
export interface WebhookMenu {
  readonly scope: { readonly type: "default" } | { readonly type: "chat"; readonly chatId: number }
  readonly languageCode: string | undefined
  readonly commands: ReadonlyArray<{ readonly command: string; readonly description: string }>
}

export interface TelegramWebhookProps {
  readonly botToken: Redacted.Redacted<string>
  readonly secretToken: Redacted.Redacted<string>
  /** `Worker.url` resolves after the Worker deploys; it may be undefined in the type. */
  readonly url: string | undefined
  /** Passed as props so the resource updates whenever the command registry changes. */
  readonly menus: ReadonlyArray<WebhookMenu>
}

export interface TelegramWebhookAttributes {
  readonly url: string
}

export type TelegramWebhook = Resource<"Telegram.Webhook", TelegramWebhookProps, TelegramWebhookAttributes>
export const TelegramWebhook = Resource<TelegramWebhook>("Telegram.Webhook")

export class TelegramWebhookError extends Data.TaggedError("TelegramWebhookError")<{
  readonly method: string
  readonly description: string
}> {}

export const scopeBody = (menu: Pick<WebhookMenu, "scope" | "languageCode">) => ({
  scope: menu.scope.type === "default" ? { type: "default" } : { type: "chat", chat_id: menu.scope.chatId },
  ...(menu.languageCode === undefined ? {} : { language_code: menu.languageCode })
})

export const callTelegram = (
  token: Redacted.Redacted<string>,
  method: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetchImpl(`https://api.telegram.org/bot${Redacted.value(token)}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
      const json = (await res.json()) as { ok: boolean; description?: string }
      if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`)
    },
    catch: (e) =>
      new TelegramWebhookError({ method, description: e instanceof Error ? e.message : String(e) })
  })

export const TelegramWebhookProvider = () =>
  Provider.succeed(
    TelegramWebhook,
    TelegramWebhook.Provider.of({
      reconcile: Effect.fn(function* ({ news }) {
        if (news.url === undefined || news.url === "") {
          return yield* new TelegramWebhookError({ method: "setWebhook", description: "worker has no public url" })
        }
        yield* callTelegram(news.botToken, "setWebhook", {
          url: news.url,
          secret_token: Redacted.value(news.secretToken),
          allowed_updates: ALLOWED_UPDATES,
          drop_pending_updates: false
        })
        for (const menu of news.menus) {
          yield* callTelegram(news.botToken, "setMyCommands", { commands: menu.commands, ...scopeBody(menu) })
        }
        return { url: news.url }
      }),
      delete: Effect.fn(function* ({ olds }) {
        yield* callTelegram(olds.botToken, "deleteWebhook", { drop_pending_updates: false }).pipe(Effect.ignore)
        for (const menu of olds.menus) {
          yield* callTelegram(olds.botToken, "deleteMyCommands", scopeBody(menu)).pipe(Effect.ignore)
        }
      }),
      list: () => Effect.succeed([])
    })
  )

export class Providers extends Provider.ProviderCollection<Providers>()("Telegram") {}

export const providers = () =>
  Layer.effect(Providers, Provider.collection([TelegramWebhook])).pipe(Layer.provide(TelegramWebhookProvider()))
