import { Context, Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"

export type KvLike = {
  readonly get: (key: string) => Promise<string | null>
  readonly put: (key: string, value: string) => Promise<void>
}

export class ReminderSettings extends Context.Service<
  ReminderSettings,
  {
    readonly getTimeZone: (tgId: TgId) => Effect.Effect<string | undefined, StorageError>
    readonly setTimeZone: (tgId: TgId, tz: string) => Effect.Effect<void, StorageError>
  }
>()("@bot/plugins-reminders/ReminderSettings") {}

export const timeZoneKey = (tgId: TgId) => `tz:${tgId}`

const key = timeZoneKey

export const layerKv = (kv: KvLike): Layer.Layer<ReminderSettings> =>
  Layer.succeed(ReminderSettings, {
    getTimeZone: (tgId) =>
      Effect.tryPromise({
        try: () => kv.get(key(tgId)),
        catch: (cause) => new StorageError({ operation: "reminders.get-tz", cause })
      }).pipe(Effect.map((v) => v ?? undefined)),
    setTimeZone: (tgId, tz) =>
      Effect.tryPromise({
        try: () => kv.put(key(tgId), tz),
        catch: (cause) => new StorageError({ operation: "reminders.set-tz", cause })
      })
  })

export const makeMemoryKv = (): KvLike & { readonly store: Map<string, string> } => {
  const store = new Map<string, string>()
  return { store, get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) }
}
