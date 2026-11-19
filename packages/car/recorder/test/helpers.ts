import { Effect, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { IDBFactory } from "fake-indexeddb"
import { sha256Hex } from "@bot/car-format/checksum"
import { makeTripId, type TripManifest } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import * as CarApiModule from "../src/api-client.ts"
import { adapterMemoryFake, type RememberedAdapter } from "../src/adapter-memory.ts"
import * as AutoModule from "../src/auto.ts"
import { connectorFake, type FakeConnectorControl } from "../src/connector.ts"
import { makeFakeGeo, makeFakeLifecycle, wakeLockFake } from "../src/platform.ts"
import * as RecorderModule from "../src/recorder.ts"
import type { ReadingEvent, ReadingInfo, ReadingSource } from "../src/recorder.ts"
import { layerIndexedDb, TripStore } from "../src/store.ts"
import * as SyncModule from "../src/sync.ts"

export const settle = (ms = 25) => Effect.promise(() => new Promise<void>((r) => setTimeout(r, ms)))
export const advance = (ms: number) => TestClock.adjust(ms).pipe(Effect.andThen(settle()), Effect.andThen(settle()))
export const eventually = <A, E, R>(f: Effect.Effect<A, E, R>, ok: (a: A) => boolean, tries = 80) =>
  Effect.gen(function* () {
    let last: A = yield* f
    for (let i = 0; i < tries && !ok(last); i++) {
      yield* settle(10)
      last = yield* f
    }
    return last
  })

export const pump = <A, E, R>(f: Effect.Effect<A, E, R>, ok: (a: A) => boolean, stepMs = 400_000, tries = 12) =>
  Effect.gen(function* () {
    let last = yield* f
    for (let i = 0; i < tries && !ok(last); i++) {
      yield* advance(stepMs)
      last = yield* eventually(f, ok, 10)
    }
    return last
  })

export type Req = {
  readonly method: string
  readonly path: string
  readonly auth: string | undefined
  readonly sha: string | undefined
  readonly body: string
}
export type Reply = { readonly status: number; readonly body: unknown } | "network"

export const apiError = (status: number, code: string, retryable: boolean) => ({
  status,
  body: { error: { code, message: code, retryable } }
})

export class FakeServer {
  readonly manifests = new Map<string, TripManifest>()
  readonly chunks = new Map<string, Map<number, { sha: string; body: string }>>()
  readonly finished = new Set<string>()
  readonly log: Array<Req> = []
  validTokens = new Set<string>(["tok-1"])
  hook: ((r: Req) => Reply | undefined) | undefined
  serverTime = 0
  pluginEnabled = true
  trips: Array<unknown> = []
  dtc: Array<unknown> = []

  count(prefix: string) {
    return this.log.filter((r) => `${r.method} ${r.path}`.startsWith(prefix)).length
  }

  private status(tripId: string) {
    const m = this.manifests.get(tripId) ?? null
    const got = this.chunks.get(tripId) ?? new Map()
    const n = m === null ? 0 : this.finished.has(tripId) ? m.chunkCount : m.chunks.length
    const missing: Array<number> = []
    const corrupt: Array<number> = []
    const received: Array<number> = []
    for (let i = 0; i < n; i++) {
      const c = got.get(i)
      if (c === undefined) missing.push(i)
      else if (m?.chunks.find((x) => x.seq === i)?.sha256 !== c.sha) corrupt.push(i)
      else received.push(i)
    }
    return {
      tripId,
      manifest: m,
      received,
      missing,
      corrupt,
      complete: m !== null && this.finished.has(tripId) && missing.length === 0 && corrupt.length === 0,
      rows: 0
    }
  }

  async handle(r: Req): Promise<Reply> {
    this.log.push(r)
    const hooked = this.hook?.(r)
    if (hooked !== undefined) return hooked
    if (
      r.path !== "/pair/complete" &&
      (r.auth === undefined || !this.validTokens.has(r.auth.replace(/^Device /, "")))
    ) {
      return apiError(401, "unauthorized", false)
    }
    const url = new URL(r.path, "http://x")
    const parts = url.pathname.split("/").filter(Boolean)
    if (r.method === "GET" && parts[0] === "me") {
      return {
        status: 200,
        body: { tgId: 1, firstName: "T", lang: "en", pluginEnabled: this.pluginEnabled, serverTime: this.serverTime }
      }
    }
    if (r.method === "PUT" && parts[0] === "dtc") {
      this.dtc.push(JSON.parse(r.body))
      return { status: 200, body: { ok: true, explanations: [] } }
    }
    if (r.method === "GET" && parts[0] === "trips" && parts.length === 1)
      return { status: 200, body: { trips: this.trips } }
    if (parts[0] === "trips" && parts.length >= 3) {
      const id = parts[1]!
      if (parts[2] === "manifest") {
        this.manifests.set(id, JSON.parse(r.body) as TripManifest)
        return { status: 200, body: { ok: true } }
      }
      if (parts[2] === "chunks") {
        const seq = Number(parts[3])
        const real = await sha256Hex(r.body)
        if (real !== r.sha) return apiError(400, "checksum_mismatch", true)
        const map = this.chunks.get(id) ?? new Map()
        this.chunks.set(id, map)
        const prev = map.get(seq)
        if (prev !== undefined && prev.sha !== real) return apiError(409, "chunk_conflict", false)
        map.set(seq, { sha: real, body: r.body })
        return { status: 200, body: { seq, stored: prev === undefined ? "new" : "already", sha256: real } }
      }
      if (parts[2] === "status") return { status: 200, body: this.status(id) }
      if (parts[2] === "finish") {
        this.finished.add(id)
        return { status: 200, body: this.status(id) }
      }
    }
    if (r.method === "POST" && parts[0] === "pair" && parts[1] === "complete") {
      return { status: 200, body: { deviceToken: "tok-2", deviceId: "d1", tgId: 1, firstName: "T" } }
    }
    return apiError(404, "not_found", false)
  }

  readonly client = HttpClient.make((request) =>
    Effect.gen({ self: this }, function* () {
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
      const u = new URL(request.url)
      const apiPath = u.pathname.replace(/^\/car\/api/, "") + u.search
      const reply = yield* Effect.promise(() =>
        this.handle({
          method: request.method,
          path: apiPath,
          auth: request.headers["authorization"],
          sha: request.headers["x-content-sha256"],
          body
        })
      )
      if (reply === "network") {
        return yield* Effect.fail(
          new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) })
        )
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { "content-type": "application/json" }
        })
      )
    })
  )
}

export const rememberedAdapter: RememberedAdapter = { deviceId: "sim-1", name: "Simulated ELM327", rememberedAt: 0 }

export const info: ReadingInfo = {
  supportedPids: ["0C"],
  fuelRateSource: "none",
  transport: "simulator",
  adapterName: "sim"
}

export const makeSource = Effect.gen(function* () {
  const q = yield* Queue.unbounded<ReadingEvent>()
  const source: ReadingSource = { readings: () => Stream.fromQueue(q) }
  return { source, emit: (e: ReadingEvent) => Queue.offer(q, e).pipe(Effect.asVoid) }
})

export const sample = (ts: number, extra: Partial<Sample> = {}): ReadingEvent => ({
  _tag: "Reading",
  sample: { ts, speedKmh: 50, rpm: 2000, ...extra }
})

export type Env = {
  readonly server: FakeServer
  readonly factory: IDBFactory
  readonly lifecycle: Effect.Success<typeof makeFakeLifecycle>
  readonly geo: Effect.Success<typeof makeFakeGeo>
  readonly wl: Effect.Success<typeof wakeLockFake>
  readonly layer: (
    credential?: CarApiModule.Credential | null
  ) => Layer.Layer<
    TripStore | CarApiModule.CarApi | RecorderModule.Recorder | SyncModule.SyncEngine | AutoModule.AutoRecorder
  >
  readonly connector: { readonly control: FakeConnectorControl }
  readonly memory: { readonly box: { value: RememberedAdapter | undefined } }
}

export const makeEnv = Effect.gen(function* () {
  const server = new FakeServer()
  const factory = new IDBFactory()
  const lifecycle = yield* makeFakeLifecycle
  const geo = yield* makeFakeGeo
  const wl = yield* wakeLockFake
  const connector = yield* connectorFake()
  const memory = yield* adapterMemoryFake(rememberedAdapter)
  const layer = (credential: CarApiModule.Credential | null = { token: "tok-1" }) => {
    const api = CarApiModule.layer({
      apiBase: "http://x/car/api",
      credential: credential ?? undefined,
      timeoutMs: 10_000
    }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, server.client)))
    const base = Layer.mergeAll(
      layerIndexedDb("t", factory),
      api,
      lifecycle.layer,
      geo.layer,
      wl.layer,
      connector.layer,
      memory.layer
    )
    const recorder = RecorderModule.layer.pipe(Layer.provide(base))
    const sync = SyncModule.layer.pipe(Layer.provide(base))
    return Layer.mergeAll(
      base,
      recorder,
      sync,
      AutoModule.layer.pipe(Layer.provide(Layer.mergeAll(base, recorder, sync)))
    )
  }
  return { server, factory, lifecycle, geo, wl, layer, connector, memory } satisfies Env
})

export const seedTrip = (n: number, opts: { finished?: boolean; at?: number } = {}) =>
  Effect.gen(function* () {
    const store = yield* TripStore
    const at = opts.at ?? 1_000_000
    const tripId = makeTripId(new Date(at), "s" + n + at.toString(36))
    yield* store.createTrip({
      formatVersion: 1,
      tripId,
      status: "recording",
      startedAt: at,
      chunkCount: 0,
      chunks: [],
      gaps: [],
      supportedPids: [],
      device: { appVersion: "t", userAgent: "t", transport: "simulator" },
      fuelRateSource: "none"
    })
    for (let i = 0; i < n; i++) {
      yield* store.appendPending(tripId, [{ ts: at + i * 10 }, { ts: at + i * 10 + 1, rpm: 900 }])
      yield* store.sealPending(tripId)
    }
    if (opts.finished !== false) {
      yield* store.updateManifest(tripId, (m) => ({
        ...m,
        status: "finished" as const,
        endedAt: at + 999,
        chunkCount: m.chunks.length
      }))
    }
    return tripId
  })
