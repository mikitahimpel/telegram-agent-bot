import { Effect, Schema } from "effect"
import type { TripStatus, TripSummary } from "@bot/car-format/api"
import { parseCsv } from "@bot/car-format/csv"
import { accountPrefix, chunkKey, manifestKey, tripPrefix } from "@bot/car-format/layout"
import { TRIP_ID_PATTERN, TripId, TripManifest } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import { analyzeTrip, type TripMetrics } from "./analytics.ts"
import { CarBucket } from "./r2.ts"

const storage = <A>(operation: string, f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

const MAX_PAGES = 30
const decodeManifest = Schema.decodeUnknownSync(TripManifest)

export const tripsPrefix = (tgId: number): string => `${accountPrefix(tgId)}trips/`
export const metricsKey = (tgId: number, tripId: TripId): string => `${tripPrefix(tgId, tripId)}metrics.json`

export const parseTripId = (text: string): TripId | undefined =>
  TRIP_ID_PATTERN.test(text) ? TripId.make(text) : undefined

/** `20261119T102030Z-ab12cd34` → epoch ms. */
export const tripIdTime = (tripId: string): number => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(tripId)
  return m === null ? NaN : Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
}

/** Trip ids of an account, newest first (ids sort by start time). */
export const listTripIds = (tgId: TgId | number, limit = 50) =>
  Effect.gen(function*() {
    const bucket = yield* CarBucket
    const prefix = tripsPrefix(tgId)
    const ids: Array<string> = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = yield* storage("car.list-trips", () =>
        bucket.list({ prefix, delimiter: "/", ...(cursor === undefined ? {} : { cursor }) })
      )
      for (const p of res.delimitedPrefixes ?? []) {
        if (!p.startsWith(prefix)) continue
        const id = p.slice(prefix.length).replace(/\/$/, "")
        if (TRIP_ID_PATTERN.test(id)) ids.push(id)
      }
      if (!res.truncated || res.cursor === undefined) break
      cursor = res.cursor
    }
    return ids.sort().reverse().slice(0, limit).map((id) => TripId.make(id))
  })

export const readManifest = (tgId: TgId | number, tripId: TripId) =>
  Effect.gen(function*() {
    const bucket = yield* CarBucket
    const o = yield* storage("car.manifest.get", () => bucket.get(manifestKey(tgId, tripId)))
    if (o === null) return null
    const text = new TextDecoder().decode(yield* storage("car.manifest.read", () => o.arrayBuffer()))
    try {
      return decodeManifest(JSON.parse(text))
    } catch {
      return null
    }
  })

export interface StoredChunk {
  readonly seq: number
  readonly size: number
  readonly sha256: string | undefined
  readonly rows: number | undefined
}

/** One paginated list per trip; includes the sha/rows metadata, so no per-chunk `head` is needed. */
export const storedChunks = (tgId: TgId | number, tripId: TripId) =>
  Effect.gen(function*() {
    const bucket = yield* CarBucket
    const prefix = `${tripPrefix(tgId, tripId)}chunks/`
    const out = new Map<number, StoredChunk>()
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = yield* storage("car.list-chunks", () =>
        bucket.list({ prefix, include: ["customMetadata"], ...(cursor === undefined ? {} : { cursor }) })
      )
      for (const o of res.objects) {
        const m = /\/(\d{6})\.csv$/.exec(o.key)
        if (m === null || !o.key.startsWith(prefix)) continue
        const seq = Number(m[1])
        const rows = o.customMetadata?.["rows"]
        out.set(seq, {
          seq,
          size: o.size,
          sha256: o.customMetadata?.["sha256"],
          rows: rows === undefined ? undefined : Number(rows)
        })
      }
      if (!res.truncated || res.cursor === undefined) break
      cursor = res.cursor
    }
    return out
  })

/** Server view of a trip: which expected chunks are stored, missing or corrupt. */
export const computeStatus = (
  tripId: string,
  manifest: TripManifest | null,
  stored: ReadonlyMap<number, StoredChunk>
): TripStatus => {
  if (manifest === null) {
    const seqs = [...stored.keys()].sort((a, b) => a - b)
    const rows = [...stored.values()].reduce((t, c) => t + (c.rows ?? 0), 0)
    return { tripId, manifest, received: seqs, missing: [], corrupt: [], complete: false, rows }
  }
  const info = new Map(manifest.chunks.map((c) => [c.seq, c] as const))
  const finished = manifest.status === "finished"
  const expected = finished
    ? Array.from({ length: manifest.chunkCount }, (_, i) => i)
    : [...info.keys()].sort((a, b) => a - b)
  const received: Array<number> = []
  const missing: Array<number> = []
  const corrupt: Array<number> = []
  let rows = 0
  for (const seq of expected) {
    const obj = stored.get(seq)
    const meta = info.get(seq)
    if (obj === undefined || meta === undefined) missing.push(seq)
    else if (obj.size !== meta.bytes || obj.sha256 !== meta.sha256) corrupt.push(seq)
    else {
      received.push(seq)
      rows += meta.rows
    }
  }
  return {
    tripId,
    manifest,
    received,
    missing,
    corrupt,
    complete: finished && missing.length === 0 && corrupt.length === 0,
    rows
  }
}

export const tripStatus = (tgId: TgId | number, tripId: TripId) =>
  Effect.gen(function*() {
    const [manifest, stored] = yield* Effect.all([readManifest(tgId, tripId), storedChunks(tgId, tripId)])
    return computeStatus(tripId, manifest, stored)
  })

export const summarize = (status: TripStatus): typeof TripSummary.Type | undefined => {
  const m = status.manifest
  if (m === null) return undefined
  return {
    tripId: status.tripId,
    startedAt: m.startedAt,
    endedAt: m.endedAt ?? null,
    status: m.status,
    chunkCount: m.status === "finished" ? m.chunkCount : m.chunks.length,
    received: status.received.length,
    complete: status.complete
  }
}

export interface TripOverview {
  readonly tripId: TripId
  readonly status: TripStatus
}

export interface OverviewFilter {
  readonly from?: Date | undefined
  readonly to?: Date | undefined
  readonly limit?: number | undefined
}

/** Newest-first trips with their status; the period filter uses the time encoded in the trip id. */
export const listOverview = (tgId: TgId | number, filter: OverviewFilter = {}) =>
  Effect.gen(function*() {
    const from = filter.from?.getTime() ?? -Infinity
    const to = filter.to?.getTime() ?? Infinity
    const ids = (yield* listTripIds(tgId, 1000))
      .filter((id) => {
        const t = tripIdTime(id)
        return t >= from - 86_400_000 && t < to
      })
      .slice(0, filter.limit ?? 50)
    const out = yield* Effect.forEach(
      ids,
      (tripId) => tripStatus(tgId, tripId).pipe(Effect.map((status): TripOverview => ({ tripId, status }))),
      { concurrency: 5 }
    )
    return out.filter((o) => {
      const t = o.status.manifest?.startedAt ?? tripIdTime(o.tripId)
      return t >= from && t < to
    })
  })

export interface ReadSamples {
  readonly samples: ReadonlyArray<Sample>
  readonly badChunks: ReadonlyArray<number>
}

/** Concatenates the verified chunks of a trip. Unreadable chunks are reported, not fatal. */
export const readSamples = (tgId: TgId | number, tripId: TripId, seqs: ReadonlyArray<number>) =>
  Effect.gen(function*() {
    const bucket = yield* CarBucket
    const parts = yield* Effect.forEach(
      seqs,
      (seq) =>
        Effect.gen(function*() {
          const o = yield* storage("car.chunk.get", () => bucket.get(chunkKey(tgId, tripId, seq)))
          if (o === null) return { seq, samples: undefined }
          const text = new TextDecoder().decode(yield* storage("car.chunk.read", () => o.arrayBuffer()))
          const parsed = yield* parseCsv(text).pipe(Effect.result)
          return { seq, samples: parsed._tag === "Success" ? parsed.success : undefined }
        }),
      { concurrency: 6 }
    )
    return {
      samples: parts.flatMap((p) => p.samples ?? []),
      badChunks: parts.filter((p) => p.samples === undefined).map((p) => p.seq)
    } satisfies ReadSamples
  })

interface CachedMetrics {
  readonly chunkCount: number
  readonly metrics: TripMetrics
}

/**
 * Metrics of a finished, complete trip. Cached in `metrics.json` next to the manifest
 * (written best-effort), so a report over many trips reads one object per trip.
 */
export const tripMetrics = (tgId: TgId | number, tripId: TripId, status: TripStatus) =>
  Effect.gen(function*() {
    const manifest = status.manifest
    if (manifest === null) return undefined
    const bucket = yield* CarBucket
    const key = metricsKey(tgId, tripId)
    if (status.complete) {
      const cached = yield* storage("car.metrics.get", () => bucket.get(key))
      if (cached !== null) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(yield* storage("car.metrics.read", () => cached.arrayBuffer()))) as CachedMetrics
          if (parsed.chunkCount === manifest.chunkCount && parsed.metrics.version === 1) return parsed.metrics
        } catch {
          // recompute
        }
      }
    }
    const { samples } = yield* readSamples(tgId, tripId, status.received)
    const metrics = analyzeTrip(samples, manifest.gaps, manifest.fuelRateSource)
    if (status.complete) {
      yield* storage("car.metrics.put", () =>
        bucket.put(key, JSON.stringify({ chunkCount: manifest.chunkCount, metrics } satisfies CachedMetrics))
      ).pipe(Effect.ignore)
    }
    return metrics
  })
