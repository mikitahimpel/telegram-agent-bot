import { Effect } from "effect"
import { sha256Hex } from "@bot/car-format/checksum"
import { chunkKey } from "@bot/car-format/layout"
import { StorageError } from "@bot/core-contracts/errors"
import { CarBackend } from "@bot/car-store/backend"
import { CarBucket } from "./r2.ts"
import { listTripIds, readManifest, storedChunks } from "./trip-store.ts"

export const REBUILD_MAX_CHUNK_READS = 300

export type RebuildResult = {
  readonly trips: number
  readonly chunksIngested: number
  readonly chunksSkipped: number
  readonly remaining: boolean
}

export const rebuildFromR2 = (tgId: number, maxReads: number = REBUILD_MAX_CHUNK_READS) =>
  Effect.gen(function*() {
    const backend = yield* CarBackend
    const bucket = yield* CarBucket
    const ids = [...(yield* listTripIds(tgId, 1000))].reverse()
    let reads = 0
    let ingested = 0
    let skipped = 0
    let trips = 0
    let remaining = false
    for (const tripId of ids) {
      const manifest = yield* readManifest(tgId, tripId)
      if (manifest === null) continue
      const stored = yield* storedChunks(tgId, tripId)
      const known = new Map((yield* backend.knownChunks(tgId, tripId)).map((c) => [c.seq, c.sha256] as const))
      const expected = new Map(manifest.chunks.map((c) => [c.seq, c.sha256] as const))
      const todo = [...stored.keys()].filter((seq) => expected.get(seq) !== undefined && known.get(seq) !== expected.get(seq))
      skipped += stored.size - todo.length
      if (reads + todo.length > maxReads && reads > 0) {
        remaining = true
        break
      }
      for (const seq of todo) {
        const obj = yield* Effect.tryPromise({
          try: () => bucket.get(chunkKey(tgId, tripId, seq)),
          catch: (cause) => new StorageError({ operation: "car.rebuild.get", cause })
        })
        reads++
        if (obj === null) continue
        const bytes = new Uint8Array(yield* Effect.tryPromise({ try: () => obj.arrayBuffer(), catch: (cause) => new StorageError({ operation: "car.rebuild.read", cause }) }))
        const sha = yield* Effect.promise(() => sha256Hex(bytes))
        const csv = new TextDecoder().decode(bytes)
        yield* backend.ingestChunk(tgId, tripId, seq, sha, csv).pipe(Effect.catch(() => Effect.void))
        ingested++
      }
      yield* backend.ingestManifest(tgId, manifest)
      trips++
    }
    const lang = (yield* backend.getMeta(tgId, "lang")) === "ru" ? "ru" : "en"
    const pending = yield* backend.pending(tgId, lang)
    yield* backend.markNotified(tgId, pending.alerts.map((a) => a.id), pending.codes.map((c) => ({ code: c.code, kind: c.kind })))
    return { trips, chunksIngested: ingested, chunksSkipped: skipped, remaining } satisfies RebuildResult
  })
