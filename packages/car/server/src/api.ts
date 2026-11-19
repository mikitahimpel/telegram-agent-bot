import { Clock, Config, Data, Effect, Schema } from "effect"
import { PairCompleteRequest, type ApiErrorCode } from "@bot/car-format/api"
import type { TripStatus } from "@bot/car-format/api"
import { sha256Hex } from "@bot/car-format/checksum"
import { CsvParseError, parseCsv } from "@bot/car-format/csv"
import { MAX_CHUNK_BYTES, MAX_MANIFEST_BYTES, chunkKey, manifestKey, tripPrefix } from "@bot/car-format/layout"
import { TripManifest, type TripId } from "@bot/car-format/manifest"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { TgId, ChatId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import { Telegram } from "@bot/core-contracts/telegram"
import { authDevice, completePair, listDevices, revokeDevice, DEVICE_CALLBACK_PREFIX } from "@bot/plugins-car/devices"
import { CarKv } from "@bot/plugins-car/kv"
import { formatDuration, formatKm, formatStamp } from "@bot/plugins-car/messages"
import { CarBucket } from "@bot/plugins-car/r2"
import { listOverview, parseTripId, summarize, tripMetrics, tripStatus } from "@bot/plugins-car/trip-store"
import { CarBackend } from "@bot/car-store/backend"
import { DtcReport } from "@bot/car-format/insights"
import { clampPoints, DEFAULT_POINTS, parseColumns } from "@bot/car-store/series"
import { ensureWeekly, notifyPending, tripSummary } from "@bot/plugins-car/notify"
import { rebuildFromR2 } from "@bot/plugins-car/rebuild"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { messages } from "./messages.ts"

export type CarApiR = CarBucket | CarKv | Allowlist | PluginFlags | Telegram | CarBackend

class ApiFail extends Data.TaggedError("ApiFail")<{
  readonly status: number
  readonly code: ApiErrorCode
  readonly message: string
  readonly retryable: boolean
}> {}

const STATUS: Record<ApiErrorCode, { status: number; retryable: boolean }> = {
  unauthorized: { status: 401, retryable: false },
  pair_code_invalid: { status: 400, retryable: false },
  forbidden: { status: 403, retryable: false },
  plugin_disabled: { status: 403, retryable: false },
  bad_request: { status: 400, retryable: false },
  checksum_mismatch: { status: 400, retryable: true },
  chunk_conflict: { status: 409, retryable: false },
  too_large: { status: 413, retryable: false },
  not_found: { status: 404, retryable: false },
  rate_limited: { status: 429, retryable: true },
  internal: { status: 500, retryable: true }
}

const apiFail = (code: ApiErrorCode, message: string) => new ApiFail({ ...STATUS[code], code, message })

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  })

const errorResponse = (e: ApiFail): Response =>
  json({ error: { code: e.code, message: e.message, retryable: e.retryable } }, e.status)

const WINDOW_MS = 60_000
const LIMIT_PER_USER = 240
const LIMIT_PAIR_PER_IP = 20
const windows = new Map<string, { start: number; count: number }>()

export const resetRateLimits = (): void => windows.clear()

const rateLimit = (key: string, limit: number, lang: Lang) =>
  Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    if (windows.size > 5000) for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k)
    const w = windows.get(key)
    if (w === undefined || now - w.start >= WINDOW_MS) windows.set(key, { start: now, count: 1 })
    else if (++w.count > limit) return yield* Effect.fail(apiFail("rate_limited", messages[lang].rateLimited))
  })

interface Principal {
  readonly tgId: TgId
  readonly firstName: string
  readonly lang: Lang
}

const authenticate = (request: Request) =>
  Effect.gen(function*() {
    const header = request.headers.get("authorization") ?? ""
    const m = /^Device\s+(\S+)$/.exec(header)
    if (m === null) return yield* Effect.fail(apiFail("unauthorized", messages.en.unauthorized))
    const record = yield* authDevice(m[1] as string)
    if (record === undefined) return yield* Effect.fail(apiFail("unauthorized", messages.en.unauthorized))
    return { tgId: TgId.make(record.tgId), firstName: record.firstName, lang: record.lang } satisfies Principal
  })

const requireAllowed = (p: Principal) =>
  Effect.gen(function*() {
    const role = yield* (yield* Allowlist).roleOf(p.tgId)
    if (role === undefined) return yield* Effect.fail(apiFail("forbidden", messages[p.lang].forbidden))
  })

const pluginEnabled = (p: Principal) => Effect.flatMap(Effect.service(PluginFlags), (f) => f.isEnabled("car", p.tgId))

const requirePlugin = (p: Principal) =>
  Effect.gen(function*() {
    if (!(yield* pluginEnabled(p))) return yield* Effect.fail(apiFail("plugin_disabled", messages[p.lang].pluginDisabled))
  })

const readBody = (request: Request, max: number, lang: Lang) =>
  Effect.gen(function*() {
    const declared = Number(request.headers.get("content-length") ?? "0")
    if (declared > max) return yield* Effect.fail(apiFail("too_large", messages[lang].tooLarge))
    const buf = yield* Effect.tryPromise({
      try: () => request.arrayBuffer(),
      catch: () => apiFail("bad_request", messages[lang].badRequest("unreadable body"))
    })
    if (buf.byteLength > max) return yield* Effect.fail(apiFail("too_large", messages[lang].tooLarge))
    return new Uint8Array(buf)
  })

const decodeManifest = Schema.decodeUnknownSync(TripManifest)

const webUrlOf = (request: Request) =>
  Effect.gen(function*() {
    const configured = yield* Config.String("CAR_WEB_URL").pipe(Config.withDefault(""))
    return configured === "" ? new URL("/car/", request.url).href : configured
  })

const forward = <A, E>(label: string, effect: Effect.Effect<A, E, CarBackend>) =>
  effect.pipe(Effect.tapError((e) => Effect.logWarning(`car store ${label} failed`, e)), Effect.option)

const langOf = (p: Principal, url: URL): Lang => {
  const q = url.searchParams.get("lang")
  return q === "ru" || q === "en" ? q : p.lang
}

const storageOp = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: () => apiFail("internal", messages.en.internal) })

const putManifest = (p: Principal, tripId: TripId, request: Request) =>
  Effect.gen(function*() {
    const m = messages[p.lang]
    const body = yield* readBody(request, MAX_MANIFEST_BYTES, p.lang)
    let manifest: TripManifest
    try {
      manifest = decodeManifest(JSON.parse(new TextDecoder().decode(body)))
    } catch (e) {
      return yield* Effect.fail(apiFail("bad_request", m.badRequest(`manifest: ${e instanceof Error ? e.message.slice(0, 200) : "invalid"}`)))
    }
    if (manifest.tripId !== tripId) {
      return yield* Effect.fail(apiFail("bad_request", m.badRequest("tripId in the path and in the manifest differ")))
    }
    const bucket = yield* CarBucket
    const key = manifestKey(p.tgId, tripId)
    const existing = yield* storageOp(() => bucket.get(key))
    if (existing !== null) {
      try {
        const old = decodeManifest(JSON.parse(new TextDecoder().decode(yield* storageOp(() => existing.arrayBuffer()))))
        if (old.status === "finished" && manifest.chunkCount < old.chunkCount) {
          return yield* Effect.fail(apiFail("chunk_conflict", m.conflict))
        }
      } catch (e) {
        if (e instanceof ApiFail) return yield* Effect.fail(e)
      }
    }
    yield* storageOp(() => bucket.put(key, JSON.stringify(manifest)))
    const backend = yield* CarBackend
    const ingested = yield* forward("manifest", backend.ingestManifest(p.tgId, manifest))
    if (ingested._tag === "Some" && ingested.value.complete) {
      yield* notifyPending(p.tgId, p.lang, yield* webUrlOf(request)).pipe(Effect.ignore)
    }
    return { ok: true as const }
  })

const putChunk = (p: Principal, tripId: TripId, seq: number, request: Request) =>
  Effect.gen(function*() {
    const m = messages[p.lang]
    const claimed = (request.headers.get("x-content-sha256") ?? "").toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(claimed)) {
      return yield* Effect.fail(apiFail("bad_request", m.badRequest("X-Content-SHA256 header is required")))
    }
    const body = yield* readBody(request, MAX_CHUNK_BYTES, p.lang)
    const actual = yield* Effect.promise(() => sha256Hex(body))
    if (actual !== claimed) return yield* Effect.fail(apiFail("checksum_mismatch", m.checksum))
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body)
    } catch {
      return yield* Effect.fail(apiFail("bad_request", m.badRequest("body is not UTF-8 text")))
    }
    const parsed = yield* parseCsv(text).pipe(
      Effect.mapError((e: CsvParseError) => apiFail("bad_request", m.badRequest(`line ${e.line}: ${e.message}`)))
    )
    if (parsed.length === 0) return yield* Effect.fail(apiFail("bad_request", m.badRequest("the chunk has no rows")))
    const bucket = yield* CarBucket
    const key = chunkKey(p.tgId, tripId, seq)
    const existing = yield* storageOp(() => bucket.head(key))
    if (existing !== null) {
      if (existing.customMetadata?.["sha256"] === actual) {
        yield* forward("chunk", (yield* CarBackend).ingestChunk(p.tgId, tripId, seq, actual, text))
        return { seq, stored: "already" as const, sha256: actual }
      }
      return yield* Effect.fail(apiFail("chunk_conflict", m.conflict))
    }
    const ts = parsed.map((s) => s.ts)
    yield* storageOp(() =>
      bucket.put(key, body, {
        customMetadata: {
          sha256: actual,
          rows: String(parsed.length),
          firstTs: String(Math.min(...ts)),
          lastTs: String(Math.max(...ts))
        }
      })
    )
    const ingested = yield* forward("chunk", (yield* CarBackend).ingestChunk(p.tgId, tripId, seq, actual, text))
    if (ingested._tag === "Some" && ingested.value.complete) {
      yield* notifyPending(p.tgId, p.lang, yield* webUrlOf(request)).pipe(Effect.ignore)
    }
    return { seq, stored: "new" as const, sha256: actual }
  })

const notifyFinished = (p: Principal, tripId: TripId, status: TripStatus, webUrl: string) =>
  Effect.gen(function*() {
    const manifest = status.manifest
    if (manifest === null) return
    const bucket = yield* CarBucket
    const marker = `${tripPrefix(p.tgId, tripId)}notified.txt`
    const missingParts = [...status.missing, ...status.corrupt].sort((a, b) => a - b)
    const state = status.complete ? "complete" : `partial:${missingParts.join(",")}`
    const prev = yield* storageOp(() => bucket.get(marker))
    if (prev !== null && new TextDecoder().decode(yield* storageOp(() => prev.arrayBuffer())) === state) return
    const m = messages[p.lang]
    const tg = yield* Telegram
    const to = { chatId: ChatId.make(p.tgId) }
    if (status.complete) {
      const backend = yield* CarBackend
      let insight = yield* backend.tripInsight(p.tgId, tripId).pipe(Effect.catch(() => Effect.succeed(null)))
      if (insight === null || !insight.complete) {
        yield* rebuildFromR2(p.tgId, 120).pipe(Effect.ignore)
        insight = yield* backend.tripInsight(p.tgId, tripId).pipe(Effect.catch(() => Effect.succeed(null)))
      }
      if (insight !== null && insight.complete) {
        const summary = tripSummary(insight, p.lang, webUrl)
        yield* tg.sendMessage(to, summary.html, summary.keyboard.length === 0 ? {} : { keyboard: summary.keyboard })
        yield* storageOp(() => bucket.put(marker, state))
        return
      }
      const metrics = yield* tripMetrics(p.tgId, tripId, status).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const seconds = metrics?.durationSeconds ?? ((manifest.endedAt ?? manifest.startedAt) - manifest.startedAt) / 1000
      const distance = metrics?.distanceKm === undefined ? "" : m.distance(formatKm(metrics.distanceKm, p.lang))
      yield* tg.sendMessage(to, m.tripSaved(formatStamp(manifest.startedAt), formatDuration(seconds, p.lang), distance, status.rows))
    } else {
      const list = missingParts.map((s) => s + 1).join(", ")
      yield* tg.sendMessage(
        to,
        m.tripPartial(status.received.length, manifest.chunkCount, list),
        webUrl === "" ? {} : { keyboard: [[{ text: m.openApp, url: webUrl }]] }
      )
    }
    yield* storageOp(() => bucket.put(marker, state))
  })

const route = (request: Request, segments: ReadonlyArray<string>, url: URL) =>
  Effect.gen(function*() {
    const method = request.method
    const [a, b, c, d] = segments

    if (a === "pair" && b === "complete" && segments.length === 2 && method === "POST") {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown"
      yield* rateLimit(`pair:${ip}`, LIMIT_PAIR_PER_IP, "en")
      const raw = yield* Effect.tryPromise({ try: () => request.json(), catch: () => apiFail("bad_request", messages.en.badRequest("invalid JSON")) })
      const req = yield* Schema.decodeUnknownEffect(PairCompleteRequest)(raw).pipe(
        Effect.mapError(() => apiFail("bad_request", messages.en.badRequest("code and deviceName are required")))
      )
      const paired = yield* completePair(req.code, req.deviceName)
      if (paired === undefined) return json({ error: { code: "pair_code_invalid", message: messages.en.pairInvalid, retryable: false } }, 400)
      const { token, record } = paired
      const m = messages[record.lang]
      const tg = yield* Telegram
      yield* tg
        .sendMessage({ chatId: ChatId.make(record.tgId) }, m.newDevice(escapeHtml(record.name)), {
          keyboard: [[{ text: m.revoke(record.name), callbackData: `${DEVICE_CALLBACK_PREFIX}:${record.deviceId}`, style: "danger" }]]
        })
        .pipe(Effect.ignore)
      return json({ deviceToken: token, deviceId: record.deviceId, tgId: record.tgId, firstName: record.firstName })
    }

    const p = yield* authenticate(request)
    yield* rateLimit(`u:${p.tgId}`, LIMIT_PER_USER, p.lang)
    yield* requireAllowed(p)

    if (a === "me" && segments.length === 1 && method === "GET") {
      const enabled = yield* pluginEnabled(p)
      const now = yield* Clock.currentTimeMillis
      return json({ tgId: p.tgId, firstName: p.firstName, lang: p.lang, pluginEnabled: enabled, serverTime: now })
    }
    if (a === "devices") {
      if (segments.length === 1 && method === "GET") {
        const devices = yield* listDevices(p.tgId)
        return json({
          devices: devices.map((x) => ({ deviceId: x.deviceId, name: x.name, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt }))
        })
      }
      if (segments.length === 2 && method === "DELETE") {
        const done = yield* revokeDevice(p.tgId, b as string)
        if (!done) return yield* Effect.fail(apiFail("not_found", messages[p.lang].notFound))
        return json({ ok: true })
      }
    }

    yield* requirePlugin(p)

    if (a === "dtc" && segments.length === 1 && method === "PUT") {
      const raw = yield* Effect.tryPromise({ try: () => request.json(), catch: () => apiFail("bad_request", messages[p.lang].badRequest("invalid JSON")) })
      const report = yield* Schema.decodeUnknownEffect(DtcReport)(raw).pipe(
        Effect.mapError(() => apiFail("bad_request", messages[p.lang].badRequest("invalid DTC report")))
      )
      if (report.codes.length > 200) return yield* Effect.fail(apiFail("too_large", messages[p.lang].tooLarge))
      const backend = yield* CarBackend
      const explanations = yield* backend.putDtc(p.tgId, report, langOf(p, url)).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal)))
      yield* notifyPending(p.tgId, p.lang, yield* webUrlOf(request)).pipe(Effect.ignore)
      return json({ ok: true, explanations })
    }
    if (a === "overview" && segments.length === 1 && method === "GET") {
      const backend = yield* CarBackend
      const counts = yield* backend.counts(p.tgId).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal)))
      if (counts.trips === 0) yield* rebuildFromR2(p.tgId).pipe(Effect.ignore)
      return json(yield* backend.overview(p.tgId, langOf(p, url)).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal))))
    }
    if (a === "alerts" && segments.length === 1 && method === "GET") {
      const backend = yield* CarBackend
      return json({ alerts: yield* backend.alerts(p.tgId, langOf(p, url)).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal))) })
    }
    if (a === "rebuild" && segments.length === 1 && method === "POST") {
      return json(yield* rebuildFromR2(p.tgId).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal))))
    }

    if (a === "trips" && segments.length === 1 && method === "GET") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50") || 50))
      const all = yield* listOverview(p.tgId, { limit })
      return json({ trips: all.flatMap((o) => summarize(o.status) ?? []) })
    }
    if (a === "trips" && b !== undefined) {
      const tripId = parseTripId(b)
      if (tripId === undefined) return yield* Effect.fail(apiFail("bad_request", messages[p.lang].badRequest("invalid trip id")))
      if (c === "manifest" && segments.length === 3 && method === "PUT") return json(yield* putManifest(p, tripId, request))
      if (c === "chunks" && segments.length === 4 && method === "PUT") {
        if (!/^\d{1,6}$/.test(d ?? "")) return yield* Effect.fail(apiFail("bad_request", messages[p.lang].badRequest("invalid seq")))
        return json(yield* putChunk(p, tripId, Number(d), request))
      }
      if (c === "insight" && segments.length === 3 && method === "GET") {
        const backend = yield* CarBackend
        const insight = yield* backend.tripInsight(p.tgId, tripId).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal)))
        if (insight === null) return yield* Effect.fail(apiFail("not_found", messages[p.lang].notFound))
        return json(insight)
      }
      if (c === "series" && segments.length === 3 && method === "GET") {
        const columns = parseColumns(url.searchParams.get("columns"))
        if (columns === undefined) return yield* Effect.fail(apiFail("bad_request", messages[p.lang].badRequest("unknown column")))
        const pointsRaw = url.searchParams.get("points")
        const points = pointsRaw === null ? DEFAULT_POINTS : clampPoints(Number(pointsRaw))
        const backend = yield* CarBackend
        const series = yield* backend.tripSeries(p.tgId, tripId, points, columns).pipe(Effect.mapError(() => apiFail("internal", messages[p.lang].internal)))
        if (series === null) return yield* Effect.fail(apiFail("not_found", messages[p.lang].notFound))
        return json(series)
      }
      if (c === "status" && segments.length === 3 && method === "GET") return json(yield* tripStatus(p.tgId, tripId))
      if (c === "finish" && segments.length === 3 && method === "POST") {
        const status = yield* tripStatus(p.tgId, tripId)
        if (status.manifest === null) return yield* Effect.fail(apiFail("not_found", messages[p.lang].notFound))
        const webUrl = yield* webUrlOf(request)
        yield* notifyFinished(p, tripId, status, webUrl).pipe(Effect.ignore)
        yield* notifyPending(p.tgId, p.lang, webUrl).pipe(Effect.ignore)
        yield* ensureWeekly(p.tgId)
        return json(status)
      }
    }
    return yield* Effect.fail(apiFail("not_found", messages[p.lang].notFound))
  })

const escapeHtml = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const handleCarApi = (request: Request): Effect.Effect<Response, never, CarApiR> => {
  const url = new URL(request.url)
  const segments = url.pathname.replace(/^\/car\/api\/?/, "").split("/").filter((s) => s !== "")
  return route(request, segments, url).pipe(
    Effect.catchCause((cause) => {
      const failure = cause.reasons.flatMap((r) => (r._tag === "Fail" ? [r.error] : []))[0]
      if (failure instanceof ApiFail) return Effect.succeed(errorResponse(failure))
      return Effect.logError("car api failed", cause).pipe(Effect.as(errorResponse(apiFail("internal", messages.en.internal))))
    })
  )
}
