import { Config, Effect, Layer } from "effect"
import { Allowlist, type AllowlistEntry } from "@bot/core-contracts/allowlist"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"

/** Minimal structural subset of a Cloudflare `KVNamespace`. */
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
}

const parseStored = (raw: string | null): StoredEntry | undefined => {
  if (raw === null) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return undefined
    const { addedAt, addedBy } = value as Record<string, unknown>
    return typeof addedAt === "number" && typeof addedBy === "number" ? { addedAt, addedBy } : undefined
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
        entries.push({ tgId: TgId.make(id), addedAt: stored.addedAt, addedBy: TgId.make(stored.addedBy) })
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
    allow: (tgId, by) =>
      storage("allowlist.allow", () =>
        kv.put(keyOf(tgId), JSON.stringify({ addedAt: Date.now(), addedBy: by } satisfies StoredEntry))
      ),
    revoke: (tgId) => storage("allowlist.revoke", () => kv.delete(keyOf(tgId))),
    list: listEntries
  }
}

/** Allowlist on a KV namespace; admin id from Config `ADMIN_TG_ID`. */
export const layer = (kv: KvLike) =>
  Layer.effect(
    Allowlist,
    Effect.gen(function* () {
      const adminId = TgId.make(yield* Config.Int("ADMIN_TG_ID"))
      return make(kv, adminId)
    })
  )

/** In-memory KV with the same shape, for tests. */
export const makeMemoryKv = (initial: ReadonlyArray<AllowlistEntry> = []): KvLike => {
  const store = new Map<string, string>(
    initial.map((e) => [`${PREFIX}${e.tgId}`, JSON.stringify({ addedAt: e.addedAt, addedBy: e.addedBy })])
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

/** In-memory Allowlist for tests. */
export const layerMemory = (adminId: TgId, initial: ReadonlyArray<AllowlistEntry> = []) =>
  Layer.succeed(Allowlist, make(makeMemoryKv(initial), adminId))
