import { Context, Effect, Layer, PubSub, Semaphore, Stream } from "effect"
import { encodeCsv } from "@bot/car-format/csv"
import { sha256Hex } from "@bot/car-format/checksum"
import type { Sample } from "@bot/car-format/sample"
import type { DtcExplanation, DtcReport } from "@bot/car-format/insights"
import type { ChunkInfo, TripManifest } from "@bot/car-format/manifest"
import { classifyStorageError, StorageFailure } from "./errors.ts"

export type DtcUploadState = "pending" | "confirmed" | "rejected"

export type DtcRecord = {
  readonly id: string
  readonly report: DtcReport
  readonly createdAt: number
  readonly uploadState: DtcUploadState
  readonly confirmedAt?: number
  readonly lastError?: string
  readonly explanations: ReadonlyArray<DtcExplanation>
}

export type ChunkUploadState = "pending" | "sent" | "confirmed" | "conflict" | "corrupt"

export type ChunkRecord = {
  readonly tripId: string
  readonly seq: number
  readonly csv: string
  readonly sha256: string
  readonly rows: number
  readonly bytes: number
  readonly firstTs: number
  readonly lastTs: number
  readonly uploadState: ChunkUploadState
  readonly lastError?: string
}

export type TripRecord = {
  readonly tripId: string
  readonly manifest: TripManifest
  readonly manifestRev: number
  readonly manifestSentRev: number
  readonly finishSent: boolean
  readonly confirmedAt?: number
  readonly localDeleted: boolean
  readonly lastSampleAt?: number
  readonly distanceKm?: number
  readonly createdAt: number
}

type PendingBatch = {
  readonly tripId: string
  readonly n: number
  readonly samples: ReadonlyArray<Sample>
}

export type StorageHealth = {
  readonly supported: boolean
  readonly usage: number
  readonly quota: number
  readonly persisted: boolean
  readonly low: boolean
}

export type StorageApiLike = {
  readonly estimate?: () => Promise<{ usage?: number; quota?: number }>
  readonly persisted?: () => Promise<boolean>
  readonly persist?: () => Promise<boolean>
}

export type TripStoreShape = {
  readonly createTrip: (manifest: TripManifest) => Effect.Effect<TripRecord, StorageFailure>
  readonly getTrip: (tripId: string) => Effect.Effect<TripRecord | undefined, StorageFailure>
  readonly listTrips: Effect.Effect<ReadonlyArray<TripRecord>, StorageFailure>
  readonly updateTrip: (
    tripId: string,
    f: (t: TripRecord) => TripRecord
  ) => Effect.Effect<TripRecord | undefined, StorageFailure>
  readonly updateManifest: (
    tripId: string,
    f: (m: TripManifest) => TripManifest
  ) => Effect.Effect<TripRecord | undefined, StorageFailure>
  readonly appendPending: (tripId: string, samples: ReadonlyArray<Sample>) => Effect.Effect<void, StorageFailure>
  readonly readPending: (tripId: string) => Effect.Effect<ReadonlyArray<Sample>, StorageFailure>
  readonly sealPending: (tripId: string) => Effect.Effect<ChunkRecord | undefined, StorageFailure>
  readonly listChunks: (tripId: string) => Effect.Effect<ReadonlyArray<ChunkRecord>, StorageFailure>
  readonly getChunk: (tripId: string, seq: number) => Effect.Effect<ChunkRecord | undefined, StorageFailure>
  readonly setChunkState: (
    tripId: string,
    seq: number,
    state: ChunkUploadState,
    lastError?: string
  ) => Effect.Effect<void, StorageFailure>
  readonly deleteTrip: (tripId: string) => Effect.Effect<void, StorageFailure>
  readonly deleteChunks: (tripId: string) => Effect.Effect<void, StorageFailure>
  readonly putDtc: (record: DtcRecord) => Effect.Effect<void, StorageFailure>
  readonly listDtc: Effect.Effect<ReadonlyArray<DtcRecord>, StorageFailure>
  readonly updateDtc: (id: string, f: (r: DtcRecord) => DtcRecord) => Effect.Effect<DtcRecord | undefined, StorageFailure>
  readonly deleteDtc: (id: string) => Effect.Effect<void, StorageFailure>
  readonly storageHealth: Effect.Effect<StorageHealth>
  readonly requestPersistence: Effect.Effect<boolean>
  readonly changes: Stream.Stream<string>
}

export class TripStore extends Context.Service<TripStore, TripStoreShape>()("@bot/car-recorder/TripStore") {}

type StoreName = "trips" | "chunks" | "pending" | "dtc"
type Op =
  | { readonly type: "put"; readonly store: StoreName; readonly value: unknown }
  | { readonly type: "delete"; readonly store: StoreName; readonly key: ReadonlyArray<unknown> | string }

export type Backend = {
  readonly get: (store: StoreName, key: ReadonlyArray<unknown> | string) => Promise<unknown>
  readonly all: (store: StoreName) => Promise<ReadonlyArray<unknown>>
  readonly byTrip: (store: "chunks" | "pending", tripId: string) => Promise<ReadonlyArray<unknown>>
  readonly write: (ops: ReadonlyArray<Op>) => Promise<void>
}

const keyPaths: Record<StoreName, ReadonlyArray<string> | string> = {
  trips: "tripId",
  chunks: ["tripId", "seq"],
  pending: ["tripId", "n"],
  dtc: "id"
}

export const makeMemoryBackend = (): Backend => {
  const data: Record<StoreName, Map<string, unknown>> = { trips: new Map(), chunks: new Map(), pending: new Map(), dtc: new Map() }
  const keyOf = (store: StoreName, v: unknown): string => {
    const p = keyPaths[store]
    const rec = v as Record<string, unknown>
    return JSON.stringify(typeof p === "string" ? rec[p] : p.map((k) => rec[k]))
  }
  return {
    get: async (store, key) => {
      const v = data[store].get(JSON.stringify(key))
      return v === undefined ? undefined : structuredClone(v)
    },
    all: async (store) => [...data[store].values()].map((v) => structuredClone(v)),
    byTrip: async (store, tripId) =>
      [...data[store].values()].filter((v) => (v as { tripId: string }).tripId === tripId).map((v) => structuredClone(v)),
    write: async (ops) => {
      for (const op of ops) {
        if (op.type === "put") data[op.store].set(keyOf(op.store, op.value), structuredClone(op.value))
        else data[op.store].delete(JSON.stringify(op.key))
      }
    }
  }
}

const DB_VERSION = 2

export const makeIndexedDbBackend = (dbName: string, factory?: IDBFactory): Backend => {
  let opened: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    if (opened !== undefined) return opened
    const f = factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
    if (f === undefined) {
      return Promise.reject(Object.assign(new Error("IndexedDB is not available"), { name: "InvalidStateError" }))
    }
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const req = f.open(dbName, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("trips")) db.createObjectStore("trips", { keyPath: "tripId" })
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["tripId", "seq"] })
        if (!db.objectStoreNames.contains("pending")) db.createObjectStore("pending", { keyPath: ["tripId", "n"] })
        if (!db.objectStoreNames.contains("dtc")) db.createObjectStore("dtc", { keyPath: "id" })
      }
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close()
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(Object.assign(new Error("IndexedDB open blocked"), { name: "InvalidStateError" }))
    })
    opened.catch(() => {
      opened = undefined
    })
    return opened
  }
  const request = <T>(r: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  return {
    get: async (store, key) => {
      const db = await open()
      return request(db.transaction(store, "readonly").objectStore(store).get(key as IDBValidKey))
    },
    all: async (store) => {
      const db = await open()
      return request(db.transaction(store, "readonly").objectStore(store).getAll())
    },
    byTrip: async (store, tripId) => {
      const db = await open()
      const range = IDBKeyRange.bound([tripId, -Infinity], [tripId, Infinity])
      return request(db.transaction(store, "readonly").objectStore(store).getAll(range))
    },
    write: async (ops) => {
      const db = await open()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...new Set(ops.map((o) => o.store))], "readwrite")
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"))
        try {
          for (const op of ops) {
            const s = tx.objectStore(op.store)
            if (op.type === "put") s.put(op.value)
            else s.delete(op.key as IDBValidKey)
          }
        } catch (e) {
          reject(e)
          try {
            tx.abort()
          } catch {
          }
        }
      })
    }
  }
}

const sealInfo = (c: ChunkRecord): ChunkInfo => ({
  seq: c.seq,
  rows: c.rows,
  bytes: c.bytes,
  sha256: c.sha256,
  firstTs: c.firstTs,
  lastTs: c.lastTs
})

export const makeTripStore = (backend: Backend, storage?: StorageApiLike) =>
  Effect.gen(function*() {
    const lock = yield* Semaphore.make(1)
    const changesPs = yield* PubSub.unbounded<string>()
    const notify = (tripId: string) => PubSub.publish(changesPs, tripId).pipe(Effect.asVoid)

    const io = <A>(f: () => Promise<A>): Effect.Effect<A, StorageFailure> =>
      Effect.tryPromise({ try: f, catch: classifyStorageError })
    const locked = <A>(f: Effect.Effect<A, StorageFailure>) => lock.withPermits(1)(f)

    const getTrip = (tripId: string) => io(() => backend.get("trips", tripId) as Promise<TripRecord | undefined>)
    const listChunks = (tripId: string) =>
      io(() => backend.byTrip("chunks", tripId) as Promise<ReadonlyArray<ChunkRecord>>).pipe(
        Effect.map((cs) => [...cs].sort((a, b) => a.seq - b.seq))
      )
    const listPending = (tripId: string) =>
      io(() => backend.byTrip("pending", tripId) as Promise<ReadonlyArray<PendingBatch>>).pipe(
        Effect.map((bs) => [...bs].sort((a, b) => a.n - b.n))
      )

    const putTrip = (next: TripRecord) =>
      io(() => backend.write([{ type: "put", store: "trips", value: next }])).pipe(Effect.as(next), Effect.tap(() => notify(next.tripId)))

    const updateTrip = (tripId: string, f: (t: TripRecord) => TripRecord) =>
      locked(
        Effect.gen(function*() {
          const cur = yield* getTrip(tripId)
          if (cur === undefined) return undefined
          return yield* putTrip(f(cur))
        })
      )

    const unsafeGetPendingRows = (tripId: string) =>
      listPending(tripId).pipe(Effect.map((bs) => bs.flatMap((b) => b.samples)))

    const store: TripStoreShape = {
      createTrip: (manifest) =>
        locked(
          putTrip({
            tripId: manifest.tripId,
            manifest,
            manifestRev: 1,
            manifestSentRev: 0,
            finishSent: false,
            localDeleted: false,
            createdAt: manifest.startedAt
          })
        ),
      getTrip,
      listTrips: io(() => backend.all("trips") as Promise<ReadonlyArray<TripRecord>>).pipe(
        Effect.map((ts) => [...ts].sort((a, b) => b.manifest.startedAt - a.manifest.startedAt))
      ),
      updateTrip,
      updateManifest: (tripId, f) =>
        updateTrip(tripId, (t) => ({ ...t, manifest: f(t.manifest), manifestRev: t.manifestRev + 1 })),
      appendPending: (tripId, samples) =>
        samples.length === 0
          ? Effect.void
          : locked(
            Effect.gen(function*() {
              const existing = yield* listPending(tripId)
              const n = (existing[existing.length - 1]?.n ?? -1) + 1
              const trip = yield* getTrip(tripId)
              const last = samples[samples.length - 1]!.ts
              const ops: Array<Op> = [{ type: "put", store: "pending", value: { tripId, n, samples } satisfies PendingBatch }]
              if (trip !== undefined) ops.push({ type: "put", store: "trips", value: { ...trip, lastSampleAt: last } })
              yield* io(() => backend.write(ops))
              yield* notify(tripId)
            })
          ),
      readPending: (tripId) => unsafeGetPendingRows(tripId),
      sealPending: (tripId) =>
        locked(
          Effect.gen(function*() {
            const trip = yield* getTrip(tripId)
            if (trip === undefined) return undefined
            const batches = yield* listPending(tripId)
            const samples = batches.flatMap((b) => b.samples)
            if (samples.length === 0) return undefined
            const csv = encodeCsv(samples)
            const sha256 = yield* Effect.promise(() => sha256Hex(csv))
            const chunk: ChunkRecord = {
              tripId,
              seq: trip.manifest.chunks.length,
              csv,
              sha256,
              rows: samples.length,
              bytes: new TextEncoder().encode(csv).length,
              firstTs: samples[0]!.ts,
              lastTs: samples[samples.length - 1]!.ts,
              uploadState: "pending"
            }
            const nextTrip: TripRecord = {
              ...trip,
              manifest: { ...trip.manifest, chunks: [...trip.manifest.chunks, sealInfo(chunk)] },
              manifestRev: trip.manifestRev + 1,
              lastSampleAt: chunk.lastTs
            }
            yield* io(() =>
              backend.write([
                { type: "put", store: "chunks", value: chunk },
                { type: "put", store: "trips", value: nextTrip },
                ...batches.map((b): Op => ({ type: "delete", store: "pending", key: [tripId, b.n] }))
              ])
            )
            yield* notify(tripId)
            return chunk
          })
        ),
      listChunks,
      getChunk: (tripId, seq) => io(() => backend.get("chunks", [tripId, seq]) as Promise<ChunkRecord | undefined>),
      setChunkState: (tripId, seq, state, lastError) =>
        locked(
          Effect.gen(function*() {
            const c = (yield* io(() => backend.get("chunks", [tripId, seq]))) as ChunkRecord | undefined
            if (c === undefined) return
            const { lastError: _drop, ...rest } = c
            const next: ChunkRecord = lastError === undefined ? { ...rest, uploadState: state } : { ...rest, uploadState: state, lastError }
            yield* io(() => backend.write([{ type: "put", store: "chunks", value: next }]))
            yield* notify(tripId)
          })
        ),
      deleteTrip: (tripId) =>
        locked(
          Effect.gen(function*() {
            const cs = yield* listChunks(tripId)
            const ps = yield* listPending(tripId)
            yield* io(() =>
              backend.write([
                ...cs.map((c): Op => ({ type: "delete", store: "chunks", key: [tripId, c.seq] })),
                ...ps.map((p): Op => ({ type: "delete", store: "pending", key: [tripId, p.n] })),
                { type: "delete", store: "trips", key: tripId }
              ])
            )
            yield* notify(tripId)
          })
        ),
      deleteChunks: (tripId) =>
        locked(
          Effect.gen(function*() {
            const cs = yield* listChunks(tripId)
            const ps = yield* listPending(tripId)
            yield* io(() =>
              backend.write([
                ...cs.map((c): Op => ({ type: "delete", store: "chunks", key: [tripId, c.seq] })),
                ...ps.map((p): Op => ({ type: "delete", store: "pending", key: [tripId, p.n] }))
              ])
            )
            yield* notify(tripId)
          })
        ),
      putDtc: (record) =>
        locked(io(() => backend.write([{ type: "put", store: "dtc", value: record }]))).pipe(
          Effect.andThen(notify("dtc"))
        ),
      listDtc: io(() => backend.all("dtc") as Promise<ReadonlyArray<DtcRecord>>).pipe(
        Effect.map((rs) => [...rs].sort((a, b) => b.report.readAt - a.report.readAt))
      ),
      updateDtc: (id, f) =>
        locked(
          Effect.gen(function*() {
            const cur = (yield* io(() => backend.get("dtc", id))) as DtcRecord | undefined
            if (cur === undefined) return undefined
            const next = f(cur)
            yield* io(() => backend.write([{ type: "put", store: "dtc", value: next }]))
            return next
          })
        ).pipe(Effect.tap(() => notify("dtc"))),
      deleteDtc: (id) => locked(io(() => backend.write([{ type: "delete", store: "dtc", key: id }]))),
      storageHealth: Effect.promise(async (): Promise<StorageHealth> => {
        const s = storage ?? (typeof navigator === "undefined" ? undefined : navigator.storage)
        if (s === undefined || s.estimate === undefined) {
          return { supported: false, usage: 0, quota: 0, persisted: false, low: false }
        }
        try {
          const e = await s.estimate()
          const usage = e.usage ?? 0
          const quota = e.quota ?? 0
          const persisted = s.persisted === undefined ? false : await s.persisted()
          const free = quota - usage
          return { supported: true, usage, quota, persisted, low: quota > 0 && (free < 50 * 1024 * 1024 || free / quota < 0.15) }
        } catch {
          return { supported: false, usage: 0, quota: 0, persisted: false, low: false }
        }
      }),
      requestPersistence: Effect.promise(async () => {
        const s = storage ?? (typeof navigator === "undefined" ? undefined : navigator.storage)
        try {
          return s?.persist === undefined ? false : await s.persist()
        } catch {
          return false
        }
      }),
      changes: Stream.fromPubSub(changesPs)
    }
    return store
  })

export const layerFromBackend = (backend: Backend, storage?: StorageApiLike): Layer.Layer<TripStore> =>
  Layer.effect(TripStore, makeTripStore(backend, storage))

export const layerIndexedDb = (dbName: string, factory?: IDBFactory, storage?: StorageApiLike): Layer.Layer<TripStore> =>
  layerFromBackend(makeIndexedDbBackend(dbName, factory), storage)

export const layerMemory: Layer.Layer<TripStore> = Layer.effect(
  TripStore,
  makeTripStore(makeMemoryBackend(), { estimate: async () => ({ usage: 0, quota: 1 << 30 }), persisted: async () => true, persist: async () => true })
)

export { StorageFailure }
