import { Data, Effect } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import { CarBucket } from "./r2.ts"
import type { R2ObjectLike } from "./r2.ts"

export class InvalidTripKey extends Data.TaggedError("InvalidTripKey")<{
  readonly key: string
  readonly message: string
}> {}

export const prefixOf = (tgId: TgId): string => `car/${tgId}/`

export const validateKey = (tgId: TgId, key: string): Effect.Effect<string, InvalidTripKey> => {
  const prefix = prefixOf(tgId)
  const rest = key.slice(prefix.length)
  const bad =
    !key.startsWith(prefix) ||
    rest === "" ||
    key.includes("\\") ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(key) ||
    key.includes("%") ||
    rest.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  return bad
    ? Effect.fail(new InvalidTripKey({ key, message: `Key must be under ${prefix} and contain no traversal` }))
    : Effect.succeed(key)
}

export interface Trip {
  readonly key: string
  readonly sizeBytes: number
  readonly uploaded: string
  readonly customMetadata: Record<string, string> | undefined
}

const toTrip = (o: R2ObjectLike): Trip => ({
  key: o.key,
  sizeBytes: o.size,
  uploaded: o.uploaded.toISOString(),
  customMetadata: o.customMetadata
})

const storage = <A>(operation: string, f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

const MAX_PAGES = 20

export interface TripFilter {
  readonly from?: Date | undefined
  readonly to?: Date | undefined
  readonly limit?: number | undefined
}

export const listTrips = (tgId: TgId, filter: TripFilter = {}) =>
  Effect.gen(function*() {
    const bucket = yield* CarBucket
    const prefix = prefixOf(tgId)
    const all: Array<R2ObjectLike> = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = yield* storage("car.list", () =>
        bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) })
      )
      all.push(...res.objects.filter((o) => o.key.startsWith(prefix)))
      if (!res.truncated || res.cursor === undefined) break
      cursor = res.cursor
    }
    const from = filter.from?.getTime() ?? -Infinity
    const to = filter.to?.getTime() ?? Infinity
    return all
      .filter((o) => o.uploaded.getTime() >= from && o.uploaded.getTime() < to)
      .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime() || (a.key < b.key ? 1 : -1))
      .slice(0, filter.limit ?? Infinity)
      .map(toTrip)
  })

export const headTrip = (tgId: TgId, key: string) =>
  Effect.gen(function*() {
    yield* validateKey(tgId, key)
    const bucket = yield* CarBucket
    const o = yield* storage("car.head", () => bucket.head(key))
    return o === null ? undefined : toTrip(o)
  })

export const readTripBytes = (tgId: TgId, key: string) =>
  Effect.gen(function*() {
    yield* validateKey(tgId, key)
    const bucket = yield* CarBucket
    const o = yield* storage("car.get", () => bucket.get(key))
    if (o === null) return undefined
    return new Uint8Array(yield* storage("car.read", () => o.arrayBuffer()))
  })

export interface Aggregate {
  readonly count: number
  readonly totalBytes: number
  readonly firstUploaded: string | undefined
  readonly lastUploaded: string | undefined
  readonly perDay: ReadonlyArray<{ readonly date: string; readonly count: number; readonly bytes: number }>
}

export const aggregate = (trips: ReadonlyArray<Trip>): Aggregate => {
  const days = new Map<string, { count: number; bytes: number }>()
  for (const t of trips) {
    const d = t.uploaded.slice(0, 10)
    const e = days.get(d) ?? { count: 0, bytes: 0 }
    days.set(d, { count: e.count + 1, bytes: e.bytes + t.sizeBytes })
  }
  const sorted = [...trips].map((t) => t.uploaded).sort()
  return {
    count: trips.length,
    totalBytes: trips.reduce((s, t) => s + t.sizeBytes, 0),
    firstUploaded: sorted[0],
    lastUploaded: sorted[sorted.length - 1],
    perDay: [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ...v }))
  }
}

const EXT = /^[a-z0-9]{1,10}$/i

export const isValidExt = (ext: string): boolean => EXT.test(ext)

export const newUploadKey = (tgId: TgId, now: Date, ext = "bin"): string => {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")
  const ts = now.toISOString().replace(/[:.]/g, "-")
  return `${prefixOf(tgId)}${ts}-${rand}.${ext.toLowerCase()}`
}
