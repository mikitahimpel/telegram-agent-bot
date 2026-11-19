import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { encodeCsv } from "@bot/car-format/csv"
import { sha256Hex } from "@bot/car-format/checksum"
import { chunkKey, manifestKey } from "@bot/car-format/layout"
import { makeTripId, type TripManifest } from "@bot/car-format/manifest"
import { layerMemory as allowlistMemory } from "@bot/bot-allowlist/allowlist"
import { TgId } from "@bot/core-contracts/ids"
import { Telegram } from "@bot/core-contracts/telegram"
import { startPair } from "@bot/plugins-car/devices"
import { CarKv, makeMemoryKv } from "@bot/plugins-car/kv"
import { CarBucket } from "@bot/plugins-car/r2"
import { makeMemoryR2 } from "@bot/plugins-car/testing"
import { layerMemory as flagsMemory } from "@bot/plugins-registry/flags"
import { handleCarApi, resetRateLimits } from "../src/api.ts"

const ADMIN = TgId.make(1)
const A = 111
const B = 222

const setup = (opts: { enabled?: boolean } = {}) => {
  const r2 = makeMemoryR2()
  const kv = makeMemoryKv()
  const sent: Array<{ to: any; html: string; options: any }> = []
  const telegram = Layer.succeed(Telegram, {
    sendMessage: (to: unknown, html: string, options: unknown) => Effect.sync(() => (sent.push({ to, html, options }), { messageId: 1 }))
  } as never)
  const flags = flagsMemory([{ id: "car", title: { en: "", ru: "" }, enabledByDefault: opts.enabled ?? true }])
  const layer = Layer.mergeAll(
    Layer.succeed(CarBucket, r2),
    Layer.succeed(CarKv, kv),
    allowlistMemory(ADMIN, [
      { tgId: TgId.make(A), addedAt: 0, addedBy: ADMIN },
      { tgId: TgId.make(B), addedAt: 0, addedBy: ADMIN }
    ]),
    flags,
    telegram
  )
  const call = (req: Request) => Effect.runPromise(handleCarApi(req).pipe(Effect.provide(layer)))
  const pair = async (tgId: number, lang: "en" | "ru" = "en") => {
    const { code } = await Effect.runPromise(startPair({ tgId, firstName: "X", lang }).pipe(Effect.provide(Layer.succeed(CarKv, kv))))
    const res = await call(req("POST", "/pair/complete", { body: JSON.stringify({ code, deviceName: "Pixel" }) }))
    return { code, res, body: (await res.clone().json()) as any }
  }
  return { r2, kv, sent, call, pair }
}

const req = (method: string, path: string, init: { token?: string; body?: BodyInit; headers?: Record<string, string> } = {}) =>
  new Request(`https://x.test/car/api${path}`, {
    method,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: { ...(init.token === undefined ? {} : { authorization: `Device ${init.token}` }), ...init.headers }
  })

const sample = (i: number) => ({ ts: 1_800_000_000_000 + i * 1000, speedKmh: 36, rpm: 1500, lat: 50 + i * 0.0001, lon: 20 })
const chunkBody = (from: number, n: number) => encodeCsv(Array.from({ length: n }, (_, i) => sample(from + i)))
const tripId = makeTripId(new Date(1_800_000_000_000), "abcd1234")

const putChunk = async (s: ReturnType<typeof setup>, token: string, seq: number, body: string, sha?: string) =>
  s.call(req("PUT", `/trips/${tripId}/chunks/${seq}`, { token, body, headers: { "x-content-sha256": sha ?? (await sha256Hex(body)) } }))

const manifestFor = async (bodies: ReadonlyArray<string>, status: "recording" | "finished"): Promise<TripManifest> => ({
  formatVersion: 1,
  tripId,
  status,
  startedAt: 1_800_000_000_000,
  endedAt: 1_800_000_060_000,
  chunkCount: bodies.length,
  chunks: await Promise.all(
    bodies.map(async (b, seq) => ({
      seq,
      rows: b.trim().split("\n").length - 1,
      bytes: new TextEncoder().encode(b).length,
      sha256: await sha256Hex(b),
      firstTs: 0,
      lastTs: 0
    }))
  ),
  gaps: [],
  supportedPids: [],
  device: { appVersion: "t", userAgent: "t", transport: "simulator" },
  fuelRateSource: "none"
})

describe("pairing", () => {
  it("is single use and returns a token; notifies the user with a revoke button", async () => {
    resetRateLimits()
    const s = setup()
    const first = await s.pair(A)
    expect(first.res.status).toBe(200)
    expect(first.body.deviceToken.length).toBeGreaterThan(30)
    expect(first.body.tgId).toBe(A)
    expect(s.sent[0]?.html).toContain("Pixel")
    expect(s.sent[0]?.options.keyboard[0][0].style).toBe("danger")
    expect(s.sent[0]?.options.keyboard[0][0].callbackData).toBe(`cardev:${first.body.deviceId}`)
    // the raw token is never stored, only its hash
    expect([...s.kv.store.keys()].some((k) => k.includes(first.body.deviceToken))).toBe(false)
    expect([...s.kv.store.values()].some((v) => v.includes(first.body.deviceToken))).toBe(false)
    const again = await s.call(req("POST", "/pair/complete", { body: JSON.stringify({ code: first.code, deviceName: "Other" }) }))
    expect(again.status).toBe(400)
    expect(((await again.json()) as any).error.code).toBe("pair_code_invalid")
  })

  it("rejects expired codes", async () => {
    resetRateLimits()
    const s = setup()
    const { code } = await Effect.runPromise(startPair({ tgId: A, firstName: "", lang: "en" }).pipe(Effect.provide(Layer.succeed(CarKv, s.kv))))
    for (const [k, v] of s.kv.store) if (k.startsWith("carpair:")) s.kv.store.set(k, JSON.stringify({ ...JSON.parse(v), expiresAt: 1 }))
    const res = await s.call(req("POST", "/pair/complete", { body: JSON.stringify({ code, deviceName: "P" }) }))
    expect(((await res.json()) as any).error.code).toBe("pair_code_invalid")
  })

  it("revoke makes the token unauthorized", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    expect((await s.call(req("GET", "/me", { token }))).status).toBe(200)
    const list = (await (await s.call(req("GET", "/devices", { token }))).json()) as any
    expect(list.devices).toHaveLength(1)
    expect((await s.call(req("DELETE", `/devices/${body.deviceId}`, { token }))).status).toBe(200)
    const after = await s.call(req("GET", "/me", { token }))
    expect(after.status).toBe(401)
    expect(((await after.json()) as any).error).toMatchObject({ code: "unauthorized", retryable: false })
  })

  it("a user cannot revoke another user's device", async () => {
    resetRateLimits()
    const s = setup()
    const a = await s.pair(A)
    const b = await s.pair(B)
    const res = await s.call(req("DELETE", `/devices/${a.body.deviceId}`, { token: b.body.deviceToken }))
    expect(res.status).toBe(404)
    expect((await s.call(req("GET", "/me", { token: a.body.deviceToken }))).status).toBe(200)
  })
})

describe("auth and gates", () => {
  it("missing/garbage auth is unauthorized", async () => {
    resetRateLimits()
    const s = setup()
    expect((await s.call(req("GET", "/me"))).status).toBe(401)
    expect((await s.call(req("GET", "/me", { token: "x".repeat(40) }))).status).toBe(401)
    expect((await s.call(new Request("https://x.test/car/api/me", { headers: { authorization: "tma abc" } }))).status).toBe(401)
  })

  it("plugin disabled → plugin_disabled (me still works); not on allowlist → forbidden", async () => {
    resetRateLimits()
    const s = setup({ enabled: false })
    const { body } = await s.pair(A)
    const me = (await (await s.call(req("GET", "/me", { token: body.deviceToken }))).json()) as any
    expect(me.pluginEnabled).toBe(false)
    const res = await s.call(req("GET", "/trips", { token: body.deviceToken }))
    expect(((await res.json()) as any).error).toMatchObject({ code: "plugin_disabled", retryable: false })
    const stranger = await s.pair(999)
    const f = await s.call(req("GET", "/me", { token: stranger.body.deviceToken }))
    expect(((await f.json()) as any).error.code).toBe("forbidden")
  })
})

describe("chunks", () => {
  it("stores, is idempotent, rejects conflicts and checksum mismatches, garbage and oversize", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    const c0 = chunkBody(0, 5)
    const r1 = await putChunk(s, token, 0, c0)
    expect(((await r1.json()) as any).stored).toBe("new")
    const stored = s.r2.objects.get(chunkKey(A, tripId, 0))!
    expect(stored.meta).toMatchObject({ rows: "5", sha256: await sha256Hex(c0) })
    const r2 = await putChunk(s, token, 0, c0)
    expect(((await r2.json()) as any).stored).toBe("already")
    const conflict = await putChunk(s, token, 0, chunkBody(100, 5))
    expect(conflict.status).toBe(409)
    expect(((await conflict.json()) as any).error).toMatchObject({ code: "chunk_conflict", retryable: false })
    const bad = await putChunk(s, token, 1, c0, "0".repeat(64))
    expect(((await bad.json()) as any).error).toMatchObject({ code: "checksum_mismatch", retryable: true })
    const garbage = "hello\nworld\n"
    expect(((await (await putChunk(s, token, 2, garbage)).json()) as any).error.code).toBe("bad_request")
    const big = "ts\n" + "1800000000000\n".repeat(50_000)
    expect(((await (await putChunk(s, token, 3, big)).json()) as any).error.code).toBe("too_large")
    expect(s.r2.objects.has(chunkKey(A, tripId, 1))).toBe(false)
  })

  it("tenant isolation: keys come from the authenticated user", async () => {
    resetRateLimits()
    const s = setup()
    const a = await s.pair(A)
    const b = await s.pair(B)
    await putChunk(s, a.body.deviceToken, 0, chunkBody(0, 3))
    expect([...s.r2.objects.keys()].every((k) => k.startsWith(`car/${A}/`))).toBe(true)
    const st = (await (await s.call(req("GET", `/trips/${tripId}/status`, { token: b.body.deviceToken }))).json()) as any
    expect(st.received).toEqual([])
    // path traversal in ids is rejected
    const bad = await s.call(req("GET", "/trips/..%2F111/status", { token: b.body.deviceToken }))
    expect(bad.status).toBe(400)
  })
})

describe("manifest, status, finish", () => {
  it("computes received / missing / corrupt and complete", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    const bodies = [chunkBody(0, 5), chunkBody(5, 5), chunkBody(10, 5)]
    const manifest = await manifestFor(bodies, "finished")
    const put = await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: JSON.stringify(manifest) }))
    expect(put.status).toBe(200)
    await putChunk(s, token, 0, bodies[0]!)
    // chunk 1 stored with different content than the manifest says → corrupt
    await putChunk(s, token, 1, chunkBody(500, 5))
    const status = (await (await s.call(req("GET", `/trips/${tripId}/status`, { token }))).json()) as any
    expect(status).toMatchObject({ received: [0], missing: [2], corrupt: [1], complete: false, rows: 5 })

    const fin = await s.call(req("POST", `/trips/${tripId}/finish`, { token }))
    expect(fin.status).toBe(200)
    expect(s.sent.at(-1)?.html).toContain("trip uploaded partially: 1 of 3 parts, missing 2, 3")
    expect(s.sent.at(-1)?.options.keyboard[0][0].url).toBe("https://x.test/car/")
    expect(s.sent.at(-1)?.options.keyboard[0][0].webAppUrl).toBeUndefined()
    const n = s.sent.length
    await s.call(req("POST", `/trips/${tripId}/finish`, { token }))
    expect(s.sent.length).toBe(n) // same state: no duplicate message

    // repair: delete corrupt, resend correct ones
    s.r2.objects.delete(chunkKey(A, tripId, 1))
    await putChunk(s, token, 1, bodies[1]!)
    await putChunk(s, token, 2, bodies[2]!)
    const done = (await (await s.call(req("POST", `/trips/${tripId}/finish`, { token }))).json()) as any
    expect(done).toMatchObject({ complete: true, missing: [], corrupt: [], rows: 15 })
    expect(s.sent.at(-1)?.html).toContain("✅ trip saved")
    expect(s.sent.at(-1)?.html).toContain("15 pts")
    const list = (await (await s.call(req("GET", "/trips", { token }))).json()) as any
    expect(list.trips[0]).toMatchObject({ tripId, status: "finished", chunkCount: 3, received: 3, complete: true })
  })

  it("manifest: tripId must match the path; a finished trip never shrinks", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    const bodies = [chunkBody(0, 2), chunkBody(2, 2)]
    const manifest = await manifestFor(bodies, "finished")
    const other = makeTripId(new Date(1_800_000_100_000), "zzzz9999")
    const wrong = await s.call(req("PUT", `/trips/${other}/manifest`, { token, body: JSON.stringify(manifest) }))
    expect(wrong.status).toBe(400)
    expect((await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: JSON.stringify(manifest) }))).status).toBe(200)
    const shrunk = await manifestFor([bodies[0]!], "finished")
    const res = await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: JSON.stringify(shrunk) }))
    expect(res.status).toBe(409)
    expect(s.r2.objects.get(manifestKey(A, tripId))).toBeDefined()
    const junk = await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: "{}" }))
    expect(junk.status).toBe(400)
  })
})
