import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TgId } from "@bot/core-contracts/ids"
import type { CommandContext } from "@bot/core-contracts/commands"
import { Telegram } from "@bot/core-contracts/telegram"
import { CarWebUrl, carPlugin } from "../src/car.ts"
import type { CarR } from "../src/car.ts"
import { parsePeriod } from "../src/period.ts"
import { layerWith } from "../src/presigner.ts"
import { CarBucket } from "../src/r2.ts"
import { CarKv, makeMemoryKv } from "../src/kv.ts"
import { makeMemoryR2 } from "../src/testing.ts"
import { completePair } from "../src/devices.ts"
import { analyzeTrip } from "../src/analytics.ts"
import { importDocument, storeImport } from "../src/import.ts"
import { encodeCsv } from "@bot/car-format/csv"
import { listOverview } from "../src/trip-store.ts"
import { listDevices } from "../src/devices.ts"
import { presignUrl } from "../src/sigv4.ts"
import { layerEngine } from "@bot/car-store/backend"
import { makeEngine } from "@bot/car-store/engine"
import { makeNodeSql } from "@bot/car-store/testing"
import { newUploadKey, validateKey } from "../src/trips.ts"

const sent: Array<{ html: string; options?: any }> = []
const telegram = Layer.succeed(Telegram, {
  sendMessage: (_to: unknown, html: string, options?: unknown) => Effect.sync(() => (sent.push({ html, options }), { messageId: 1 })),
  answerCallbackQuery: () => Effect.void
} as never)

const r2 = makeMemoryR2()
const kv = makeMemoryKv()
for (const k of ["car/1/a.bin", "car/1/b.bin", "car/12/secret.bin", "car/2/x.bin"]) await r2.put(k, "xx")

const env = Layer.mergeAll(
  Layer.succeed(CarBucket, r2),
  Layer.succeed(CarKv, kv),
  Layer.succeed(CarWebUrl, "https://bot.test/car/"),
  layerEngine(makeEngine(makeNodeSql())),
  layerWith({ accountId: "acc", accessKeyId: "AK", secretAccessKey: "SK", bucketName: "bkt" }),
  telegram
)

const tool = (name: string) => carPlugin.tools.find((t) => t.name === name)!
const run = <A, E>(e: Effect.Effect<A, E, CarR>) => e.pipe(Effect.provide(env))
const tg1 = { tgId: TgId.make(1) }
const ctxOf = (args: string, tgId = 1): CommandContext => ({ tgId: TgId.make(tgId), chatId: tgId as never, threadId: undefined, sessionKey: "main" as never, role: "user", lang: "en", args, messageId: 1 })

describe("sigv4", () => {
  it("matches the AWS documented presigned GET example", async () => {
    const url = await presignUrl({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      expiresSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z")
    })
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")
  })

  it.effect("car_app_link gives a one-time pairing link for the caller's account", () =>
    Effect.gen(function*() {
      const res = (yield* run(tool("car_app_link").handler({}, tg1))) as { url: string; expiresInMinutes: number }
      expect(res.url.startsWith("https://bot.test/car/#pair=")).toBe(true)
      expect(res.expiresInMinutes).toBe(30)
      const code = res.url.split("#pair=")[1] ?? ""
      const first = yield* run(completePair(code, "Chrome · Pixel"))
      expect(first?.record.tgId).toBe(1)
      const second = yield* run(completePair(code, "Chrome · Pixel"))
      expect(second).toBeUndefined()
    })
  )

  it.effect("presigned PUT url shape", () =>
    Effect.gen(function*() {
      const res: any = yield* run(tool("car_upload_link").handler({ ext: "csv" }, tg1))
      const u = new URL(res.url)
      expect(u.host).toBe("acc.r2.cloudflarestorage.com")
      expect(u.pathname.startsWith("/bkt/car/1/")).toBe(true)
      expect(u.pathname.endsWith(".csv")).toBe(true)
      expect(u.searchParams.get("X-Amz-Expires")).toBe("900")
      expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host")
      expect(u.searchParams.get("X-Amz-Credential")).toMatch(/^AK\/\d{8}\/auto\/s3\/aws4_request$/)
      expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/)
    })
  )
})

describe("tenant isolation", () => {
  it.effect("lists only own prefix (raw uploads) and own trips", () =>
    Effect.gen(function*() {
      const res: any = yield* run(tool("car_list_trips").handler({}, tg1))
      expect(res.uploads.map((t: any) => t.key).sort()).toEqual(["car/1/a.bin", "car/1/b.bin"])
      expect(res.trips).toEqual([])
    })
  )

  it.effect("rejects foreign and traversal keys", () =>
    Effect.gen(function*() {
      for (const key of ["car/2/x.bin", "car/12/secret.bin", "car/1/../2/x.bin", "car/1/", "car/1//a.bin", "/car/1/a.bin", "car/1/%2e%2e/x", "car/1\\a"]) {
        const exit = yield* run(tool("car_get_trip").handler({ key }, tg1)).pipe(Effect.exit)
        expect(exit._tag, key).toBe("Failure")
      }
      for (const tripId of ["../2", "car/2/x", "nonsense"]) {
        const exit = yield* run(tool("car_get_trip").handler({ tripId }, tg1)).pipe(Effect.exit)
        expect(exit._tag, tripId).toBe("Failure")
      }
      expect(yield* validateKey(TgId.make(1), "car/1/a.bin")).toBe("car/1/a.bin")
    })
  )

  it.effect("get_trip returns presigned GET for own raw key", () =>
    Effect.gen(function*() {
      const res: any = yield* run(tool("car_get_trip").handler({ key: "car/1/a.bin" }, tg1))
      expect(res.found).toBe(true)
      expect(res.downloadUrl).toContain("/bkt/car/1/a.bin?")
    })
  )

  it("upload key shape", () => {
    expect(newUploadKey(TgId.make(5), new Date("2026-11-19T10:20:30.123Z"), "BIN")).toMatch(
      /^car\/5\/2026-11-19T10-20-30-123Z-[0-9a-f]{8}\.bin$/
    )
  })
})

const drive = (n: number, extra: Record<string, number> = {}) =>
  Array.from({ length: n }, (_, i) => ({ ts: 1_800_000_000_000 + i * 1000, speedKmh: 36, rpm: 1500, coolantC: 90, fuelRateLph: 3.6, ...extra }))

describe("analytics", () => {
  it("integrates speed, fuel, idle and never across gaps or jumps", () => {
    const m = analyzeTrip(drive(11), [], "pid_5e")
    expect(m.distanceSource).toBe("obd")
    expect(m.distanceKm).toBeCloseTo(0.1, 6)
    expect(m.fuelLiters).toBeCloseTo(0.01, 6)
    expect(m.avgSpeedKmh).toBeCloseTo(36, 6)
    expect(m.maxSpeedKmh).toBe(36)
    expect(m.avgCoolantC).toBe(90)
    expect(m.fuelIsEstimate).toBe(false)
    expect(analyzeTrip(drive(11), [], "maf_estimate").fuelIsEstimate).toBe(true)
    const jump = [...drive(5), ...drive(5).map((s) => ({ ...s, ts: s.ts + 64_000 }))]
    expect(analyzeTrip(jump, [], "none").distanceKm).toBeCloseTo(0.08, 6)
    const gapped = analyzeTrip(drive(11), [{ from: 1_800_000_003_500, to: 1_800_000_004_500, reason: "unknown" }], "none")
    expect(gapped.distanceKm).toBeCloseTo(0.08, 6)
    const idle = analyzeTrip(drive(11, { speedKmh: 0 }), [], "none")
    expect(idle.idleSeconds).toBe(10)
  })

  it("falls back to GPS haversine when OBD speed is missing", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ ts: 1_800_000_000_000 + i * 1000, lat: 50 + i * 0.0001, lon: 20 }))
    const m = analyzeTrip(pts, [], "none")
    expect(m.distanceSource).toBe("gps")
    expect(m.distanceKm).toBeCloseTo(0.1112, 3)
  })
})

const listDevicesFor = (id: number) => listDevices(id)
const sendLines = () => sent.at(-1)!.html

describe("trips, report, app, devices", () => {
  it.effect("import → trips → report → tools; other tenants see nothing", () =>
    Effect.gen(function*() {
      const cmd = carPlugin.commands[0]!
      const csv = encodeCsv(drive(61))
      const res = yield* run(storeImport(7, csv, "t.csv"))
      expect(res.points).toBe(61)
      expect(r2.objects.has(`car/7/imports/${res.tripId}.csv`)).toBe(true)
      expect((yield* run(storeImport(7, csv, "t.csv"))).tripId).toBe(res.tripId)

      sent.length = 0
      yield* run(cmd.handler(ctxOf("trips", 7)))
      expect(sendLines()).toContain("✅")
      expect(sendLines()).toContain("61 pts")
      yield* run(cmd.handler(ctxOf("report 2027-01", 7)))
      expect(sendLines()).toContain("<pre>")
      expect(sendLines()).toContain("Trips: <b>1</b>")
      yield* run(cmd.handler(ctxOf("report 2027-01", 8)))
      expect(sendLines()).toContain("No complete trips")
      yield* run(cmd.handler(ctxOf("report bogus", 7)))
      expect(sendLines()).toContain("Unknown period")

      expect((yield* run(listOverview(8))).length).toBe(0)
      const list: any = yield* run(tool("car_list_trips").handler({}, { tgId: TgId.make(7) }))
      expect(list.trips[0]).toMatchObject({ tripId: res.tripId, complete: true, points: 61 })
      const got: any = yield* run(tool("car_get_trip").handler({ tripId: res.tripId }, { tgId: TgId.make(7) }))
      expect(got.chunks).toHaveLength(1)
      expect(got.chunks[0].url).toContain(`/bkt/car/7/trips/${res.tripId}/chunks/000000.csv?`)
      expect(got.manifestUrl).toContain("manifest.json?")
      expect(got.metrics.distanceKm).toBeCloseTo(0.6, 5)
      const foreign: any = yield* run(tool("car_get_trip").handler({ tripId: res.tripId }, { tgId: TgId.make(8) }))
      expect(foreign.found).toBe(false)
      const q: any = yield* run(tool("car_query").handler({ metric: "distanceKm" }, { tgId: TgId.make(7) }))
      expect(q.metric.sum).toBeCloseTo(0.6, 5)
      expect(q.completeTrips).toBe(1)
      const q8: any = yield* run(tool("car_query").handler({}, { tgId: TgId.make(8) }))
      expect(q8.trips).toBe(0)
      const bad: any = yield* run(tool("car_query").handler({ metric: "nope" }, tg1))
      expect(bad.available).toBe(false)
    })
  )

  it.effect("incomplete trip is flagged with N/M", () =>
    Effect.gen(function*() {
      const res = yield* run(storeImport(9, encodeCsv(drive(2500)), "big.csv"))
      yield* Effect.promise(() => r2.delete(`car/9/trips/${res.tripId}/chunks/000001.csv`))
      sent.length = 0
      yield* run(carPlugin.commands[0]!.handler(ctxOf("trips", 9)))
      expect(sendLines()).toContain("⚠️")
      expect(sendLines()).toContain("2/3 parts")
    })
  )

  it.effect("/car app sends a one-time url button (no web_app); /car devices lists and revokes", () =>
    Effect.gen(function*() {
      const cmd = carPlugin.commands[0]!
      sent.length = 0
      yield* run(cmd.handler(ctxOf("", 5)))
      const btn = sent[0]!.options.keyboard[0][0]
      expect(btn.url).toMatch(/^https:\/\/bot\.test\/car\/#pair=[0-9a-f]{32}$/)
      expect(btn.webAppUrl).toBeUndefined()
      expect(sent[0]!.html).toContain("30 minutes")
      const { completePair } = yield* Effect.promise(() => import("../src/devices.ts"))
      const code = btn.url.split("#pair=")[1]
      const paired = yield* run(completePair(code, "Pixel 8"))
      expect(paired?.record.tgId).toBe(5)
      expect(yield* run(completePair(code, "again"))).toBeUndefined()
      yield* run(cmd.handler(ctxOf("devices", 5)))
      expect(sendLines()).toContain("Pixel 8")
      const cb = carPlugin.callbacks[0]!
      const other = { tgId: TgId.make(6), chatId: 6 as never, threadId: undefined, sessionKey: "main" as never, role: "user" as const, lang: "en" as const, messageId: 1, payload: paired!.record.deviceId, callbackId: "c" }
      yield* run(cb.handler(other))
      expect((yield* run(listDevicesFor(5))).length).toBe(1)
      yield* run(cb.handler({ ...other, tgId: TgId.make(5) }))
      expect((yield* run(listDevicesFor(5))).length).toBe(0)
    })
  )

  it.effect("document import: precise errors and success", () =>
    Effect.gen(function*() {
      const ctx = { tgId: TgId.make(3), chatId: 3 as never, threadId: undefined, lang: "en" as const }
      const doc = { file_id: "f", file_name: "trip.csv", file_size: 10 }
      expect(yield* run(importDocument(ctx, { file_id: "f", file_name: "photo.png" }))).toBe(false)
      sent.length = 0
      expect(yield* run(importDocument(ctx, { ...doc, file_size: 25 * 1024 * 1024 }))).toBe(true)
      expect(sendLines()).toContain("20 MB")
      const bad = yield* run(storeImport(3, "ts,rpm\n1800000000000,1000\n1800000001000,abc\n", "x.csv")).pipe(Effect.flip)
      expect(bad).toMatchObject({ _tag: "CsvParseError", line: 3 })
      const empty = yield* run(storeImport(3, "ts,rpm\n", "x.csv")).pipe(Effect.flip)
      expect(empty._tag).toBe("EmptyImport")
      const tiny = yield* run(storeImport(3, "ts\n5\n", "x.csv")).pipe(Effect.flip)
      expect(tiny).toMatchObject({ _tag: "CsvParseError", line: 2 })
    })
  )
})

describe("parsePeriod", () => {
  const now = new Date("2026-11-19T12:00:00Z")
  it("parses forms", () => {
    expect(parsePeriod(undefined, now)?.label).toBe("30d")
    expect(parsePeriod("7d", now)?.from.toISOString()).toBe("2026-11-12T12:00:00.000Z")
    expect(parsePeriod("month", now)?.from.toISOString()).toBe("2026-11-01T00:00:00.000Z")
    const ym = parsePeriod("2026-02", now)!
    expect(ym.from.toISOString()).toBe("2026-02-01T00:00:00.000Z")
    expect(ym.to.toISOString()).toBe("2026-03-01T00:00:00.000Z")
  })
  it("rejects garbage", () => {
    for (const s of ["0d", "2026-13", "week", "7", "-3d"]) expect(parsePeriod(s, now), s).toBeUndefined()
  })
})
