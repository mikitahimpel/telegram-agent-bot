import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { encodeCsv } from "@bot/car-format/csv"
import { sha256Hex } from "@bot/car-format/checksum"
import { chunkKey, manifestKey } from "@bot/car-format/layout"
import { makeTripId, type TripManifest } from "@bot/car-format/manifest"
import { backendFromInvoke, runEngineOp } from "@bot/car-store/backend"
import { CarBackend } from "@bot/car-store/backend"
import { makeEngine, type CarEngine } from "@bot/car-store/engine"
import { makeNodeSql } from "@bot/car-store/testing"
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
    sendMessage: (to: unknown, html: string, options: unknown) =>
      Effect.sync(() => (sent.push({ to, html, options }), { messageId: 1 }))
  } as never)
  const engines = new Map<number, CarEngine>()
  const engineOf = (tgId: number) => {
    let e = engines.get(tgId)
    if (e === undefined) {
      e = makeEngine(makeNodeSql())
      engines.set(tgId, e)
    }
    return e
  }
  const backend = Layer.succeed(
    CarBackend,
    backendFromInvoke(async (tgId, op, args) => runEngineOp(engineOf(tgId), op, args))
  )
  const flags = flagsMemory([{ id: "car", title: { en: "", ru: "" }, enabledByDefault: opts.enabled ?? true }])
  const layer = Layer.mergeAll(
    Layer.succeed(CarBucket, r2),
    Layer.succeed(CarKv, kv),
    allowlistMemory(ADMIN, [
      { tgId: TgId.make(A), addedAt: 0, addedBy: ADMIN },
      { tgId: TgId.make(B), addedAt: 0, addedBy: ADMIN }
    ]),
    flags,
    telegram,
    backend
  )
  const call = (req: Request) => Effect.runPromise(handleCarApi(req).pipe(Effect.provide(layer)))
  const pair = async (tgId: number, lang: "en" | "ru" = "en") => {
    const { code } = await Effect.runPromise(
      startPair({ tgId, firstName: "X", lang }).pipe(Effect.provide(Layer.succeed(CarKv, kv)))
    )
    const res = await call(req("POST", "/pair/complete", { body: JSON.stringify({ code, deviceName: "Pixel" }) }))
    return { code, res, body: (await res.clone().json()) as any }
  }
  return { r2, kv, sent, call, pair, engineOf }
}

const req = (
  method: string,
  path: string,
  init: { token?: string; body?: BodyInit; headers?: Record<string, string> } = {}
) =>
  new Request(`https://x.test/car/api${path}`, {
    method,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: { ...(init.token === undefined ? {} : { authorization: `Device ${init.token}` }), ...init.headers }
  })

const sample = (i: number) => ({
  ts: 1_800_000_000_000 + i * 1000,
  speedKmh: 36,
  rpm: 1500,
  lat: 50 + i * 0.0001,
  lon: 20
})
const chunkBody = (from: number, n: number) => encodeCsv(Array.from({ length: n }, (_, i) => sample(from + i)))
const tripId = makeTripId(new Date(1_800_000_000_000), "abcd1234")

const putChunk = async (s: ReturnType<typeof setup>, token: string, seq: number, body: string, sha?: string) =>
  s.call(
    req("PUT", `/trips/${tripId}/chunks/${seq}`, {
      token,
      body,
      headers: { "x-content-sha256": sha ?? (await sha256Hex(body)) }
    })
  )

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
    expect([...s.kv.store.keys()].some((k) => k.includes(first.body.deviceToken))).toBe(false)
    expect([...s.kv.store.values()].some((v) => v.includes(first.body.deviceToken))).toBe(false)
    const again = await s.call(
      req("POST", "/pair/complete", { body: JSON.stringify({ code: first.code, deviceName: "Other" }) })
    )
    expect(again.status).toBe(400)
    expect(((await again.json()) as any).error.code).toBe("pair_code_invalid")
  })

  it("rejects expired codes", async () => {
    resetRateLimits()
    const s = setup()
    const { code } = await Effect.runPromise(
      startPair({ tgId: A, firstName: "", lang: "en" }).pipe(Effect.provide(Layer.succeed(CarKv, s.kv)))
    )
    for (const [k, v] of s.kv.store)
      if (k.startsWith("carpair:")) s.kv.store.set(k, JSON.stringify({ ...JSON.parse(v), expiresAt: 1 }))
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
    expect(
      (await s.call(new Request("https://x.test/car/api/me", { headers: { authorization: "tma abc" } }))).status
    ).toBe(401)
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
    const st = (await (
      await s.call(req("GET", `/trips/${tripId}/status`, { token: b.body.deviceToken }))
    ).json()) as any
    expect(st.received).toEqual([])
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
    expect(s.sent.length).toBe(n)

    s.r2.objects.delete(chunkKey(A, tripId, 1))
    await putChunk(s, token, 1, bodies[1]!)
    await putChunk(s, token, 2, bodies[2]!)
    const done = (await (await s.call(req("POST", `/trips/${tripId}/finish`, { token }))).json()) as any
    expect(done).toMatchObject({ complete: true, missing: [], corrupt: [], rows: 15 })
    expect(s.sent.at(-1)?.html).toContain("Trip finished")
    expect(s.sent.at(-1)?.options.keyboard[0][0].url).toBe(`https://x.test/car/#trip=${tripId}`)
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
    expect(
      (await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: JSON.stringify(manifest) }))).status
    ).toBe(200)
    const shrunk = await manifestFor([bodies[0]!], "finished")
    const res = await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: JSON.stringify(shrunk) }))
    expect(res.status).toBe(409)
    expect(s.r2.objects.get(manifestKey(A, tripId))).toBeDefined()
    const junk = await s.call(req("PUT", `/trips/${tripId}/manifest`, { token, body: "{}" }))
    expect(junk.status).toBe(400)
  })
})

const richSamples = (start: number, seconds: number, restingV: number) =>
  Array.from({ length: seconds }, (_, t) =>
    t < 20
      ? { ts: start + t * 1000, speedKmh: 0, rpm: 0, voltageV: restingV }
      : {
          ts: start + t * 1000,
          speedKmh: 50,
          rpm: 2000,
          coolantC: 90,
          voltageV: 14.1,
          fuelRateLph: 5,
          lat: 50 + t * 0.0001,
          lon: 20
        }
  )

const uploadRich = async (s: ReturnType<typeof setup>, token: string, restingV: number, seconds = 700, id = tripId) => {
  const samples = richSamples(1_800_000_000_000, seconds, restingV)
  const parts = [samples.slice(0, 300), samples.slice(300, 600), samples.slice(600)].filter((p) => p.length > 0)
  const bodies = parts.map((p) => encodeCsv(p as never))
  const manifest = { ...(await manifestFor(bodies, "finished")), tripId: id, fuelRateSource: "pid_5e" as const }
  for (const [seq, b] of bodies.entries()) {
    await s.call(
      req("PUT", `/trips/${id}/chunks/${seq}`, { token, body: b, headers: { "x-content-sha256": await sha256Hex(b) } })
    )
  }
  await s.call(req("PUT", `/trips/${id}/manifest`, { token, body: JSON.stringify(manifest) }))
  return s.call(req("POST", `/trips/${id}/finish`, { token }))
}

const getJson = async (s: ReturnType<typeof setup>, token: string, path: string) => {
  const res = await s.call(req("GET", path, { token }))
  return { status: res.status, body: (await res.json()) as any }
}

describe("insights endpoints", () => {
  it("serves insight, series, alerts and overview for an uploaded trip and notifies once", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    await uploadRich(s, token, 12.1)
    const insight = await getJson(s, token, `/trips/${tripId}/insight`)
    expect(insight.status).toBe(200)
    expect(insight.body).toMatchObject({ tripId, complete: true, points: 700 })
    expect(insight.body.distanceKm).toBeGreaterThan(8)
    expect(insight.body.restingVoltageV).toBeCloseTo(12.1, 2)
    const series = await getJson(s, token, `/trips/${tripId}/series?points=50&columns=speed_kmh,voltage_v`)
    expect(series.status).toBe(200)
    expect(series.body.ts.length).toBeLessThanOrEqual(50)
    expect(Object.keys(series.body.columns)).toEqual(["speed_kmh", "voltage_v"])
    expect((await getJson(s, token, `/trips/${tripId}/series?columns=bogus`)).status).toBe(400)
    expect(
      (await getJson(s, token, `/trips/${makeTripId(new Date(1_700_000_000_000), "nope0000")}/insight`)).status
    ).toBe(404)
    const alerts = await getJson(s, token, "/alerts")
    expect(alerts.body.alerts.map((a: any) => a.kind)).toContain("battery_weak")
    const overview = await getJson(s, token, "/overview")
    expect(overview.body.totals.trips).toBe(1)
    expect(overview.body.battery.status).toBe("weak")
    expect(overview.body.alerts[0].whatToDo.length).toBeGreaterThan(10)
    const texts = s.sent.map((m) => m.html)
    expect(texts.some((t) => t.includes("Trip finished"))).toBe(true)
    expect(texts.filter((t) => t.includes("battery")).length).toBe(1)
    const before = s.sent.length
    await s.call(req("POST", `/trips/${tripId}/finish`, { token }))
    expect(s.sent.length).toBe(before)
  })

  it("keeps every user's data separate", async () => {
    resetRateLimits()
    const s = setup()
    const a = await s.pair(A)
    const b = await s.pair(B)
    await uploadRich(s, a.body.deviceToken, 12.6)
    expect((await getJson(s, b.body.deviceToken, "/overview")).body.totals.trips).toBe(0)
    expect((await getJson(s, b.body.deviceToken, `/trips/${tripId}/insight`)).status).toBe(404)
    expect((await getJson(s, b.body.deviceToken, "/alerts")).body.alerts).toEqual([])
  })

  it("heals an empty store from R2 on overview and via rebuild", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    await uploadRich(s, token, 12.6)
    const fresh = setup()
    const pairedFresh = await fresh.pair(A)
    for (const [k, v] of s.r2.objects) fresh.r2.objects.set(k, v)
    const o = await getJson(fresh, pairedFresh.body.deviceToken, "/overview")
    expect(o.body.totals.trips).toBe(1)
    const again = await fresh.call(req("POST", "/rebuild", { token: pairedFresh.body.deviceToken }))
    expect((await again.json()) as any).toMatchObject({ chunksIngested: 0, remaining: false })
  })

  it("stores a dtc report, explains codes, notifies urgent codes once and exposes them in the overview", async () => {
    resetRateLimits()
    const s = setup()
    const { body } = await s.pair(A)
    const token = body.deviceToken as string
    const report = {
      readAt: 1_800_000_000_000,
      milOn: true,
      codes: [
        { code: "P0300", kind: "stored" },
        { code: "P1234", kind: "pending" }
      ],
      tripId: null,
      vin: null
    }
    const put = await s.call(req("PUT", "/dtc", { token, body: JSON.stringify(report) }))
    expect(put.status).toBe(200)
    const out = (await put.json()) as any
    expect(out.ok).toBe(true)
    expect(out.explanations.map((e: any) => [e.code, e.source])).toEqual([
      ["P0300", "catalog"],
      ["P1234", "generic"]
    ])
    const msg = s.sent.find((m) => m.html.includes("P0300"))!
    expect(msg.html).toContain("URGENT")
    expect(msg.options.keyboard[0][0].url).toBe("https://x.test/car/#engine")
    const count = s.sent.length
    await s.call(req("PUT", "/dtc", { token, body: JSON.stringify({ ...report, readAt: report.readAt + 1000 }) }))
    expect(s.sent.length).toBe(count)
    const overview = await getJson(s, token, "/overview")
    expect(overview.body.engine).toMatchObject({ milOn: true })
    expect(overview.body.engine.activeCodes).toHaveLength(2)
    expect((await s.call(req("PUT", "/dtc", { token, body: JSON.stringify({ readAt: 1 }) }))).status).toBe(400)
    expect(
      (
        await s.call(
          req("PUT", "/dtc", { token, body: JSON.stringify({ ...report, codes: [{ code: "zz", kind: "stored" }] }) })
        )
      ).status
    ).toBe(400)
  })

  it("requires a device token", async () => {
    resetRateLimits()
    const s = setup()
    for (const [m, p] of [
      ["GET", "/overview"],
      ["GET", "/alerts"],
      ["PUT", "/dtc"],
      ["POST", "/rebuild"],
      ["GET", `/trips/${tripId}/insight`]
    ] as const) {
      expect((await s.call(req(m, p))).status).toBe(401)
    }
  })
})
