import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { UserScheduler } from "@bot/bot-scheduler/user-scheduler"
import { sha256Hex } from "@bot/car-format/checksum"
import { encodeCsv } from "@bot/car-format/csv"
import { chunkKey, manifestKey } from "@bot/car-format/layout"
import { makeTripId, type TripManifest } from "@bot/car-format/manifest"
import { CarBackend, layerEngine } from "@bot/car-store/backend"
import { makeEngine } from "@bot/car-store/engine"
import { makeNodeSql } from "@bot/car-store/testing"
import { TgId } from "@bot/core-contracts/ids"
import type { ScheduledJob } from "@bot/core-contracts/scheduler"
import { Telegram } from "@bot/core-contracts/telegram"
import { carPlugin } from "../src/car.ts"
import { ensureWeekly, nextWeeklyAt, notifyPending, tripSummary, weeklyJob, weeklyJobId } from "../src/notify.ts"
import { CarBucket } from "../src/r2.ts"
import { rebuildFromR2 } from "../src/rebuild.ts"
import { makeMemoryR2 } from "../src/testing.ts"
import { CarWebUrl } from "../src/web-url.ts"

const T0 = Date.UTC(2026, 10, 1, 8, 0, 0)
const DAY = 86_400_000
const ME = 42

const samples = (start: number, seconds: number, restingV = 12.6) =>
  Array.from({ length: seconds }, (_, t) => ({
    ts: start + t * 1000,
    speedKmh: t < 20 ? 0 : 50,
    rpm: t < 20 ? 0 : 2000,
    coolantC: 90,
    voltageV: t < 20 ? restingV : 14.1,
    fuelRateLph: t < 20 ? 0 : 5
  }))

const trip = async (start: number, seconds: number, restingV?: number) => {
  const rows = samples(start, seconds, restingV)
  const csv = encodeCsv(rows)
  const sha = await sha256Hex(csv)
  const tripId = makeTripId(new Date(start), "abcd1234")
  const manifest: TripManifest = {
    formatVersion: 1,
    tripId,
    status: "finished",
    startedAt: start,
    endedAt: start + seconds * 1000,
    chunkCount: 1,
    chunks: [{ seq: 0, rows: rows.length, bytes: new TextEncoder().encode(csv).length, sha256: sha, firstTs: start, lastTs: start + (seconds - 1) * 1000 }],
    gaps: [],
    supportedPids: [],
    device: { appVersion: "t", userAgent: "t", transport: "simulator" },
    fuelRateSource: "pid_5e"
  }
  return { tripId, manifest, csv, sha }
}

const setup = (now = () => T0 + 10 * DAY) => {
  const sent: Array<{ html: string; options: any }> = []
  const jobs = new Map<string, ScheduledJob>()
  const engine = makeEngine(makeNodeSql(), now)
  const r2 = makeMemoryR2()
  const layer = Layer.mergeAll(
    layerEngine(engine),
    Layer.succeed(CarBucket, r2),
    Layer.succeed(CarWebUrl, "https://bot.test/car/"),
    Layer.succeed(Telegram, { sendMessage: (_t: unknown, html: string, options: unknown) => Effect.sync(() => (sent.push({ html, options }), { messageId: 1 })) } as never),
    Layer.succeed(UserScheduler, {
      forUser: () => ({
        schedule: (j: ScheduledJob) => Effect.sync(() => void jobs.set(j.id, j)),
        cancel: (id: string) => Effect.sync(() => void jobs.delete(id)),
        get: (id: string) => Effect.sync(() => jobs.get(id)),
        list: (kind: string) => Effect.sync(() => [...jobs.values()].filter((j) => j.kind === kind))
      })
    })
  )
  return { sent, jobs, engine, r2, run: <A, E>(e: Effect.Effect<A, E, any>) => Effect.runPromise(e.pipe(Effect.provide(layer)) as Effect.Effect<A, E>) }
}

const tool = (name: string) => carPlugin.tools.find((t) => t.name === name)!

describe("agent tools", () => {
  it("car_sql reads only, car_overview and car_dtc answer from the server data", async () => {
    const s = setup()
    const t = await trip(T0, 700)
    s.engine.ingestChunk(t.tripId, 0, t.sha, t.csv)
    s.engine.ingestManifest(t.manifest)
    s.engine.putDtc({ readAt: T0, milOn: true, codes: [{ code: "P0420", kind: "stored" }], tripId: null, vin: null }, "en")
    const ctx = { tgId: TgId.make(ME) }
    const q = (await s.run(tool("car_sql").handler({ query: "SELECT COUNT(*) AS n FROM car_trips" }, ctx))) as any
    expect(q).toMatchObject({ columns: ["n"], rows: [[1]], truncated: false })
    const bad = (await s.run(tool("car_sql").handler({ query: "DELETE FROM car_trips" }, ctx))) as any
    expect(bad.error).toMatch(/not allowed|SELECT/)
    expect((await s.run(tool("car_sql").handler({ query: "PRAGMA table_info(car_trips)" }, ctx)) as any).error).toBeDefined()
    expect(tool("car_sql").description).toContain("car_samples")
    const o = (await s.run(tool("car_overview").handler({}, ctx))) as any
    expect(o.totals.trips).toBe(1)
    const d = (await s.run(tool("car_dtc").handler({}, ctx))) as any
    expect(d.codes[0]).toMatchObject({ code: "P0420", source: "catalog" })
    expect(d.milOn).toBe(true)
  })
})

describe("notifications", () => {
  it("builds the trip summary with distance, time, consumption and a deep link", async () => {
    const s = setup()
    const t = await trip(T0, 1200)
    s.engine.ingestChunk(t.tripId, 0, t.sha, t.csv)
    s.engine.ingestManifest(t.manifest)
    const insight = s.engine.tripInsight(t.tripId)!
    const r = tripSummary(insight, "en", "https://bot.test/car/")
    expect(r.html).toContain("Trip finished")
    expect(r.html).toContain("L/100 km")
    expect(r.html).toContain("km")
    expect(r.keyboard[0]![0]!.url).toBe(`https://bot.test/car/#trip=${t.tripId}`)
    const ru = tripSummary(insight, "ru", "https://bot.test/car/")
    expect(ru.html).toContain("Поездка завершена")
    expect(ru.html).toContain("л/100 км")
    expect(tripSummary(insight, "en", "").keyboard).toEqual([])
  })

  it("sends new alerts and codes immediately, once, and marks urgent ones", async () => {
    const s = setup()
    const t = await trip(T0, 700, 12.1)
    s.engine.ingestChunk(t.tripId, 0, t.sha, t.csv)
    s.engine.ingestManifest(t.manifest)
    s.engine.putDtc({ readAt: T0, milOn: true, codes: [{ code: "P0301", kind: "stored" }], tripId: null, vin: null }, "en")
    expect(await s.run(notifyPending(ME, "en", "https://bot.test/car/"))).toBe(2)
    expect(s.sent.some((m) => m.html.includes("URGENT") && m.html.includes("P0301"))).toBe(true)
    expect(s.sent.some((m) => m.html.includes("battery") && m.options.keyboard[0][0].url.endsWith("#battery"))).toBe(true)
    expect(s.sent.filter((m) => m.html.includes("Check engine"))).toHaveLength(0)
    expect(await s.run(notifyPending(ME, "en", "https://bot.test/car/"))).toBe(0)
    expect(s.sent).toHaveLength(2)
  })

  it("schedules the weekly summary once and the job sends it and reschedules", async () => {
    const now = T0 + 10 * DAY
    const s = setup(() => now)
    const t = await trip(now - 2 * DAY, 1800)
    s.engine.ingestChunk(t.tripId, 0, t.sha, t.csv)
    s.engine.ingestManifest(t.manifest)
    await s.run(Effect.gen(function*() {
      yield* (yield* CarBackend).setMeta(ME, "lang", "ru")
      yield* ensureWeekly(ME)
      yield* ensureWeekly(ME)
    }))
    expect(s.jobs.size).toBe(1)
    const job = s.jobs.get(weeklyJobId(ME))!
    expect(job.kind).toBe("car_weekly")
    expect(job.at).toBeLessThanOrEqual(Date.now() + 7 * DAY)
    expect(new Date(job.at).getUTCDay()).toBe(0)
    expect(job.at).toBeGreaterThan(Date.now())
    expect(carPlugin.jobs?.map((j) => j.kind)).toEqual(["car_weekly"])
    await s.run(weeklyJob.run(job, { tgId: TgId.make(ME), now: job.at }))
    expect(s.sent[0]!.html).toContain("Ваша машина за неделю")
    expect(s.sent[0]!.html).toContain("Поездок: <b>1</b>")
    expect(s.jobs.get(weeklyJobId(ME))!.at).toBe(job.at + 7 * DAY)
  })

  it("nextWeeklyAt is the next Sunday 18:00 in the user's time zone, strictly after now", () => {
    const sunday = Date.UTC(2026, 10, 15, 18, 0, 0)
    expect(nextWeeklyAt(sunday - 1)).toBe(sunday)
    expect(nextWeeklyAt(sunday)).toBe(sunday + 7 * DAY)
    expect(new Date(nextWeeklyAt(Date.UTC(2026, 10, 18, 3, 0, 0))).toISOString()).toBe("2026-11-22T18:00:00.000Z")
    expect(new Date(nextWeeklyAt(Date.UTC(2026, 10, 18, 3, 0, 0), "Europe/Warsaw")).toISOString()).toBe("2026-11-22T17:00:00.000Z")
    expect(new Date(nextWeeklyAt(Date.UTC(2026, 2, 25, 12, 0, 0), "Europe/Warsaw")).toISOString()).toBe("2026-03-29T16:00:00.000Z")
    expect(new Date(nextWeeklyAt(Date.UTC(2026, 10, 22, 16, 30, 0), "Asia/Tokyo")).toISOString()).toBe("2026-11-29T09:00:00.000Z")
    expect(nextWeeklyAt(sunday - 1, "Not/AZone")).toBe(sunday)
  })
})

describe("rebuild from R2", () => {
  it("replays manifests and chunks into an empty store without notifying and is idempotent", async () => {
    const s = setup()
    const t = await trip(T0, 700, 12.1)
    await s.r2.put(manifestKey(ME, t.manifest.tripId), JSON.stringify(t.manifest))
    await s.r2.put(chunkKey(ME, t.manifest.tripId, 0), t.csv, { customMetadata: { sha256: t.sha, rows: "700" } })
    const first = await s.run(rebuildFromR2(ME))
    expect(first).toMatchObject({ trips: 1, chunksIngested: 1, remaining: false })
    expect(s.engine.counts()).toEqual({ trips: 1, complete: 1 })
    expect(s.engine.pending("en").alerts).toHaveLength(0)
    expect(s.engine.alerts("en")).toHaveLength(1)
    const second = await s.run(rebuildFromR2(ME))
    expect(second).toMatchObject({ chunksIngested: 0, chunksSkipped: 1 })
  })
})
