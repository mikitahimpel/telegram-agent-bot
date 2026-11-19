import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseCsv } from "@bot/car-format/csv"
import { exportTrip } from "../src/export.ts"
import { layerMemory, TripStore } from "../src/store.ts"
import { seedTrip } from "./helpers.ts"

describe("export", () => {
  it.effect("merges chunks with a single header and includes unsealed samples", () =>
    Effect.gen(function*() {
      const id = yield* seedTrip(3, { finished: false })
      yield* (yield* TripStore).appendPending(id, [{ ts: 5000 }])
      const out = yield* exportTrip(id)
      const text = yield* Effect.promise(() => out.csv.text())
      expect(text.match(/^ts,/gm)).toHaveLength(1)
      const rows = yield* parseCsv(text)
      expect(rows).toHaveLength(7)
      expect(out.fileName).toBe(`car-${id}.csv`)
      const manifest = JSON.parse(yield* Effect.promise(() => out.manifestJson.text()))
      expect(manifest.tripId).toBe(id)
    }).pipe(Effect.provide(layerMemory)))

  it.effect("fails when a local chunk is gone", () =>
    Effect.gen(function*() {
      const id = yield* seedTrip(2)
      yield* (yield* TripStore).deleteChunks(id)
      const err = yield* exportTrip(id).pipe(Effect.flip)
      expect(err._tag).toBe("ExportFailure")
    }).pipe(Effect.provide(layerMemory)))
})
