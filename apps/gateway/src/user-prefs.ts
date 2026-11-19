import { Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import { timeZoneKey } from "@bot/plugins-reminders/settings"
import type { Env } from "./env.ts"

const call = <A>(operation: string, f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

const make = (env: Env, lang: (tgId: TgId) => Effect.Effect<Lang | undefined, StorageError>): UserPrefs["Service"] => ({
  timeZone: (tgId) => call("prefs.tz", () => env.KV.get(timeZoneKey(tgId))).pipe(Effect.map((v) => v ?? undefined)),
  lang
})

export const rpcUserPrefs = (env: Env): Layer.Layer<UserPrefs> =>
  Layer.succeed(
    UserPrefs,
    make(env, (tgId) => call("prefs.rpc.lang", () => env.USER_AGENT.getByName(String(tgId)).storedLang()))
  )

export type LangSql = {
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly exec: (query: string, ...bindings: Array<any>) => { readonly toArray: () => Array<any> }
}

export const readStoredLang = (sql: LangSql): Lang | undefined => {
  try {
    const value = sql.exec("SELECT value FROM settings WHERE key = 'lang'").toArray()[0]?.value
    return value === "ru" || value === "en" ? value : undefined
  } catch {
    return undefined
  }
}

export const localUserPrefs = (env: Env, own: TgId, sql: LangSql): Layer.Layer<UserPrefs> =>
  Layer.succeed(
    UserPrefs,
    make(env, (tgId) =>
      tgId === own
        ? Effect.sync(() => readStoredLang(sql))
        : Effect.fail(
            new StorageError({ operation: "prefs.lang", cause: new Error(`prefs of ${own} asked for ${tgId}`) })
          )
    )
  )
