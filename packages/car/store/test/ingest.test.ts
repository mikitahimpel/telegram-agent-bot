import { describe, expect, it } from "vite-plus/test"
import { buildTrip, cruise, gen, ingestAll, newEngine, T0 } from "./helpers.ts"

describe("ingestion", () => {
  it("is idempotent per trip and seq", async () => {
    const { sql, engine } = newEngine()
    const trip = await buildTrip(T0, gen(T0, 300, cruise(60)))
    const first = engine.ingestChunk(trip.tripId, 0, trip.chunks[0]!.sha, trip.chunks[0]!.csv)
    expect(first.stored).toBe("new")
    const again = engine.ingestChunk(trip.tripId, 0, trip.chunks[0]!.sha, trip.chunks[0]!.csv)
    expect(again.stored).toBe("already")
    expect(sql.all("SELECT COUNT(*) AS c FROM car_samples")[0]!["c"]).toBe(120)
    expect(sql.all("SELECT COUNT(*) AS c FROM car_chunks")[0]!["c"]).toBe(1)
  })

  it("replaces a chunk when the checksum changes", async () => {
    const { sql, engine } = newEngine()
    const a = await buildTrip(T0, gen(T0, 100, cruise(60)))
    const b = await buildTrip(T0, gen(T0, 100, cruise(90)))
    engine.ingestChunk(a.tripId, 0, a.chunks[0]!.sha, a.chunks[0]!.csv)
    const out = engine.ingestChunk(a.tripId, 0, b.chunks[0]!.sha, b.chunks[0]!.csv)
    expect(out.stored).toBe("replaced")
    expect(sql.all("SELECT COUNT(*) AS c, MAX(speed_kmh) AS m FROM car_samples")[0]).toEqual({ c: 100, m: 90 })
  })

  it("marks the trip complete only when every chunk matches the manifest and computes metrics once", async () => {
    const { sql, engine } = newEngine()
    const trip = await buildTrip(T0, gen(T0, 300, cruise(60)))
    engine.ingestChunk(trip.tripId, 0, trip.chunks[0]!.sha, trip.chunks[0]!.csv)
    expect(engine.ingestManifest(trip.manifest).complete).toBe(false)
    engine.ingestChunk(trip.tripId, 1, trip.chunks[1]!.sha, trip.chunks[1]!.csv)
    const done = engine.ingestChunk(trip.tripId, 2, trip.chunks[2]!.sha, trip.chunks[2]!.csv)
    expect(done.complete).toBe(true)
    expect(sql.all("SELECT complete, distance_km FROM car_trips")[0]!["complete"]).toBe(1)
    expect(engine.counts()).toEqual({ trips: 1, complete: 1 })
  })

  it("accepts the manifest before the chunks and replaying everything changes nothing", async () => {
    const { sql, engine } = newEngine()
    const trip = await buildTrip(T0, gen(T0, 300, cruise(60)))
    engine.ingestManifest(trip.manifest)
    ingestAll(engine, trip)
    const before = sql.all("SELECT COUNT(*) AS c FROM car_samples")[0]
    ingestAll(engine, trip)
    expect(sql.all("SELECT COUNT(*) AS c FROM car_samples")[0]).toEqual(before)
    expect(engine.tripInsight(trip.tripId)?.complete).toBe(true)
  })
})
