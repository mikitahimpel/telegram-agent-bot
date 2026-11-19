import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TgId } from "@bot/core-contracts/ids"
import type { CommandContext } from "@bot/core-contracts/commands"
import { Telegram } from "@bot/core-contracts/telegram"
import { carPlugin } from "../src/car.ts"
import type { CarR } from "../src/car.ts"
import { parsePeriod } from "../src/period.ts"
import { layerWith } from "../src/presigner.ts"
import { CarBucket } from "../src/r2.ts"
import type { R2Like, R2ObjectLike } from "../src/r2.ts"
import { presignUrl } from "../src/sigv4.ts"
import { layerUnknownFormat } from "../src/trip-parser.ts"
import { newUploadKey, validateKey } from "../src/trips.ts"

const fakeR2 = (seed: ReadonlyArray<[string, number, string]>): R2Like => {
  const objs: R2ObjectLike[] = seed.map(([key, size, up]) => ({ key, size, uploaded: new Date(up) }))
  return {
    get: async () => null,
    put: async () => null,
    head: async (k) => objs.find((o) => o.key === k) ?? null,
    list: async (o) => ({ objects: objs.filter((x) => x.key.startsWith(o?.prefix ?? "")), truncated: false }),
    delete: async () => undefined
  }
}

const sent: string[] = []
const telegram = Layer.succeed(Telegram, {
  sendMessage: (_to: unknown, html: string) => Effect.sync(() => (sent.push(html), { messageId: 1 }))
} as never)

const r2 = fakeR2([
  ["car/1/a.bin", 100, "2026-11-01T10:00:00Z"],
  ["car/1/b.bin", 200, "2026-11-10T10:00:00Z"],
  ["car/12/secret.bin", 999, "2026-11-10T10:00:00Z"],
  ["car/2/x.bin", 5, "2026-11-10T10:00:00Z"]
])

const env = Layer.mergeAll(
  Layer.succeed(CarBucket, r2),
  layerWith({ accountId: "acc", accessKeyId: "AK", secretAccessKey: "SK", bucketName: "bkt" }),
  layerUnknownFormat,
  telegram
)

const tool = (name: string) => carPlugin.tools.find((t) => t.name === name)!
const run = <A, E>(e: Effect.Effect<A, E, CarR>) => e.pipe(Effect.provide(env))
const tg1 = { tgId: TgId.make(1) }

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
  it.effect("lists only own prefix", () =>
    Effect.gen(function*() {
      const res: any = yield* run(tool("car_list_trips").handler({}, tg1))
      expect(res.trips.map((t: any) => t.key)).toEqual(["car/1/b.bin", "car/1/a.bin"])
    })
  )

  it.effect("rejects foreign and traversal keys", () =>
    Effect.gen(function*() {
      for (const key of ["car/2/x.bin", "car/12/secret.bin", "car/1/../2/x.bin", "car/1/", "car/1//a.bin", "/car/1/a.bin", "car/1/%2e%2e/x", "car/1\\a"]) {
        const exit = yield* run(tool("car_get_trip").handler({ key }, tg1)).pipe(Effect.exit)
        expect(exit._tag, key).toBe("Failure")
      }
      expect(yield* validateKey(TgId.make(1), "car/1/a.bin")).toBe("car/1/a.bin")
    })
  )

  it.effect("get_trip returns presigned GET for own key", () =>
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

describe("query and commands", () => {
  it.effect("car_query metric reports unknown format", () =>
    Effect.gen(function*() {
      const r2b = fakeR2([["car/1/a.bin", 1, "2026-11-01T00:00:00Z"]])
      const withBytes: R2Like = { ...r2b, get: async (k) => ({ key: k, size: 1, uploaded: new Date(), arrayBuffer: async () => new ArrayBuffer(1) }) }
      const res: any = yield* tool("car_query").handler({ metric: "fuel" }, tg1).pipe(
        Effect.provide(Layer.mergeAll(telegram, Layer.succeed(CarBucket, withBytes), layerUnknownFormat, layerWith({ accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucketName: "b" })))
      )
      expect(res.metric.available).toBe(false)
      expect(res.aggregate.count).toBe(1)
    })
  )

  it.effect("/car trips and report", () =>
    Effect.gen(function*() {
      const cmd = carPlugin.commands[0]!
      const ctx = (args: string): CommandContext => ({ tgId: tg1.tgId, chatId: 1 as never, threadId: undefined, sessionKey: "main" as never, role: "user", lang: "en", args, messageId: 1 })
      sent.length = 0
      yield* run(cmd.handler(ctx("trips")))
      expect(sent[0]).toContain("b.bin")
      expect(sent[0]).not.toContain("secret")
      yield* run(cmd.handler(ctx("report 2026-11")))
      expect(sent[1]).toContain("Files: <b>2</b>")
      expect(sent[1]).toContain("not defined yet")
      yield* run(cmd.handler(ctx("report bogus")))
      expect(sent[2]).toContain("Unknown period")
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
