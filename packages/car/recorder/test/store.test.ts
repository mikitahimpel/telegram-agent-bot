import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { IDBFactory } from "fake-indexeddb"
import { StorageFailure } from "../src/errors.ts"
import { layerFromBackend, layerIndexedDb, layerMemory, makeMemoryBackend, TripStore } from "../src/store.ts"
import { clearCredentials, loadCredentials, saveCredentials } from "../src/credentials.ts"
import { seedTrip } from "./helpers.ts"

describe("TripStore", () => {
  it.effect("memory layer seals pending rows into a chunk atomically", () =>
    Effect.gen(function* () {
      const id = yield* seedTrip(2, { finished: false })
      const store = yield* TripStore
      const chunks = yield* store.listChunks(id)
      expect(chunks.map((c) => c.seq)).toEqual([0, 1])
      expect(chunks[0]!.csv.startsWith("ts,")).toBe(true)
      expect(yield* store.readPending(id)).toEqual([])
      expect((yield* store.getTrip(id))!.manifest.chunks).toHaveLength(2)
    }).pipe(Effect.provide(layerMemory))
  )

  it.effect("indexeddb data survives a new store instance", () => {
    const factory = new IDBFactory()
    return Effect.gen(function* () {
      const id = yield* Effect.provide(seedTrip(1), layerIndexedDb("d", factory))
      const again = yield* TripStore.use((s) => s.listChunks(id)).pipe(Effect.provide(layerIndexedDb("d", factory)))
      expect(again).toHaveLength(1)
    })
  })

  it.effect("quota error surfaces as StorageFailure{quota}", () => {
    const backend = makeMemoryBackend()
    const failing = {
      ...backend,
      write: async () => {
        throw new DOMException("full", "QuotaExceededError")
      }
    }
    return Effect.gen(function* () {
      const store = yield* TripStore
      const exit = yield* Effect.exit(store.appendPending("x", [{ ts: 1 }]))
      expect(Exit.isFailure(exit)).toBe(true)
      const err = yield* store.appendPending("x", [{ ts: 1 }]).pipe(Effect.flip)
      expect(err).toBeInstanceOf(StorageFailure)
      expect(err.reason).toBe("quota")
    }).pipe(Effect.provide(layerFromBackend(failing)))
  })

  it.effect("credentials round-trip", () => {
    const factory = new IDBFactory()
    return Effect.gen(function* () {
      expect(yield* loadCredentials({ factory })).toBeUndefined()
      yield* saveCredentials({ deviceToken: "t", deviceId: "d", tgId: 5 }, { factory })
      expect((yield* loadCredentials({ factory }))?.deviceToken).toBe("t")
      yield* clearCredentials({ factory })
      expect(yield* loadCredentials({ factory })).toBeUndefined()
    })
  })

  it.effect("storageHealth reports low space and persistence", () =>
    Effect.gen(function* () {
      const h = yield* TripStore.use((s) => s.storageHealth)
      expect(h).toMatchObject({ supported: true, persisted: false, low: true })
      expect(yield* TripStore.use((s) => s.requestPersistence)).toBe(true)
    }).pipe(
      Effect.provide(
        layerFromBackend(makeMemoryBackend(), {
          estimate: async () => ({ usage: 95, quota: 100 }),
          persisted: async () => false,
          persist: async () => true
        })
      )
    )
  )
})
