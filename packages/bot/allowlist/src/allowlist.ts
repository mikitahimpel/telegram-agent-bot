import { Config, Effect, Layer } from "effect"
import { Allowlist, type AllowlistEntry } from "@bot/core-contracts/allowlist"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"

export interface KvLike {
  readonly get: (key: string) => Promise<string | null>
  readonly put: (key: string, value: string) => Promise<void>
  readonly delete: (key: string) => Promise<void>
  readonly list: (options?: { readonly prefix?: string; readonly cursor?: string }) => Promise<{
    readonly keys: ReadonlyArray<{ readonly name: string }>
    readonly list_complete: boolean
    readonly cursor?: string | undefined
  }>
}

const PREFIX = "allow:"

interface StoredEntry {
  readonly addedAt: number
  readonly addedBy: number
  readonly name?: string
  readonly username?: string
  readonly invitedVia?: string
}

const parseStored = (raw: string | null): StoredEntry | undefined => {
  if (raw === null) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return undefined
    const { addedAt, addedBy } = value as Record<string, unknown>
    if (typeof addedAt !== "number" || typeof addedBy !== "number") return undefined
    const { name, username, invitedVia } = value as Record<string, unknown>
    return {
      addedAt,
      addedBy,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof username === "string" ? { username } : {}),
      ...(typeof invitedVia === "string" ? { invitedVia } : {})
    }
  } catch {
    return undefined
  }
}

const storage = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new StorageError({ operation, cause }) })

export const make = (kv: KvLike, adminId: TgId): Allowlist["Service"] => {
  const keyOf = (tgId: TgId) => `${PREFIX}${tgId}`

  const listEntries = Effect.gen(function* () {
    const entries: Array<AllowlistEntry> = []
    let cursor: string | undefined
    for (;;) {
      const page = yield* storage("allowlist.list", () =>
        kv.list(cursor === undefined ? { prefix: PREFIX } : { prefix: PREFIX, cursor })
      )
      for (const { name } of page.keys) {
        const id = Number(name.slice(PREFIX.length))
        if (!Number.isSafeInteger(id)) continue
        const stored = parseStored(yield* storage("allowlist.get", () => kv.get(name)))
        if (stored === undefined) continue
        entries.push({ ...stored, tgId: TgId.make(id), addedBy: TgId.make(stored.addedBy) })
      }
      if (page.list_complete || page.cursor === undefined) return entries
      cursor = page.cursor
    }
  })

  return {
    adminId,
    roleOf: (tgId) =>
      tgId === adminId
        ? Effect.succeed("admin" as const)
        : storage("allowlist.roleOf", () => kv.get(keyOf(tgId))).pipe(
            Effect.map((raw) => (parseStored(raw) === undefined ? undefined : ("user" as const)))
          ),
    allow: (tgId, by, meta) =>
      storage("allowlist.allow", () =>
        kv.put(
          keyOf(tgId),
          JSON.stringify({
            addedAt: Date.now(),
            addedBy: by,
            ...(meta?.name === undefined ? {} : { name: meta.name }),
            ...(meta?.username === undefined ? {} : { username: meta.username }),
            ...(meta?.invitedVia === undefined ? {} : { invitedVia: meta.invitedVia })
          } satisfies StoredEntry)
        )
      ),
    updateProfile: (tgId, profile) =>
      Effect.gen(function* () {
        const stored = parseStored(yield* storage("allowlist.profile.get", () => kv.get(keyOf(tgId))))
        if (stored === undefined) return
        if (stored.name === profile.name && stored.username === profile.username) return
        const { name: _n, username: _u, ...rest } = stored
        yield* storage("allowlist.profile.put", () =>
          kv.put(
            keyOf(tgId),
            JSON.stringify({
              ...rest,
              ...(profile.name === undefined ? {} : { name: profile.name }),
              ...(profile.username === undefined ? {} : { username: profile.username })
            })
          )
        )
      }),
    revoke: (tgId) => storage("allowlist.revoke", () => kv.delete(keyOf(tgId))),
    list: listEntries
  }
}

export const layer = (kv: KvLike) =>
  Layer.effect(
    Allowlist,
    Effect.gen(function* () {
      const adminId = TgId.make(yield* Config.Int("ADMIN_TG_ID"))
      return make(kv, adminId)
    })
  )

export const makeMemoryKv = (initial: ReadonlyArray<AllowlistEntry> = []): KvLike => {
  const store = new Map<string, string>(
    initial.map((e) => {
      const { tgId, ...rest } = e
      return [`${PREFIX}${tgId}`, JSON.stringify(rest)] as [string, string]
    })
  )
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
    list: async (options) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(options?.prefix ?? "")).map((name) => ({ name })),
      list_complete: true
    })
  }
}

export const layerMemory = (adminId: TgId, initial: ReadonlyArray<AllowlistEntry> = []) =>
  Layer.succeed(Allowlist, make(makeMemoryKv(initial), adminId))
