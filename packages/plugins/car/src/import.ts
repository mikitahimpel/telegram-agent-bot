import { Config, Data, Effect, Redacted } from "effect"
import { sha256Hex } from "@bot/car-format/checksum"
import { CsvParseError, encodeCsv, parseCsv } from "@bot/car-format/csv"
import { chunkKey, importKey, manifestKey } from "@bot/car-format/layout"
import { makeTripId, type ChunkInfo, type TripManifest } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import { StorageError } from "@bot/core-contracts/errors"
import type { ChatId, TgId, ThreadId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import { Telegram } from "@bot/core-contracts/telegram"
import { analyzeTrip, type TripMetrics } from "./analytics.ts"
import { escapeHtml, formatDuration, formatKm, formatStamp, messages } from "./messages.ts"
import { CarBucket } from "./r2.ts"

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const ROWS_PER_CHUNK = 1000
/** 2000-01-01; anything smaller is not epoch milliseconds. */
const MIN_TS = 946_684_800_000

export class EmptyImport extends Data.TaggedError("EmptyImport")<{}> {}

export interface ImportResult {
  readonly tripId: string
  readonly points: number
  readonly startedAt: number
  readonly metrics: TripMetrics
}

/** Validates the CSV and stores it as `imports/<tripId>.csv` plus a normal, synthesized trip (manifest + chunks). */
export const storeImport = (tgId: TgId | number, text: string, fileName: string) =>
  Effect.gen(function*() {
    const parsed = yield* parseCsv(text)
    if (parsed.length === 0) return yield* Effect.fail(new EmptyImport())
    const bad = parsed.findIndex((s) => s.ts < MIN_TS)
    if (bad >= 0) {
      return yield* Effect.fail(new CsvParseError({ line: bad + 2, message: "ts must be epoch milliseconds" }))
    }
    const samples: ReadonlyArray<Sample> = [...parsed].sort((a, b) => a.ts - b.ts)
    const first = samples[0] as Sample
    const last = samples[samples.length - 1] as Sample
    const fileHash = yield* Effect.promise(() => sha256Hex(text))
    const tripId = makeTripId(new Date(first.ts), fileHash.slice(0, 8))
    const bucket = yield* CarBucket
    const put = (op: string, key: string, body: string, meta?: Record<string, string>) =>
      Effect.tryPromise({
        try: () => bucket.put(key, body, meta === undefined ? undefined : { customMetadata: meta }),
        catch: (cause) => new StorageError({ operation: op, cause })
      })

    yield* put("car.import.raw", importKey(tgId, tripId), text)
    const chunks: Array<ChunkInfo> = []
    for (let seq = 0; seq * ROWS_PER_CHUNK < samples.length; seq++) {
      const part = samples.slice(seq * ROWS_PER_CHUNK, (seq + 1) * ROWS_PER_CHUNK)
      const body = encodeCsv(part)
      const sha256 = yield* Effect.promise(() => sha256Hex(body))
      const info: ChunkInfo = {
        seq,
        rows: part.length,
        bytes: new TextEncoder().encode(body).length,
        sha256,
        firstTs: (part[0] as Sample).ts,
        lastTs: (part[part.length - 1] as Sample).ts
      }
      chunks.push(info)
      yield* put("car.import.chunk", chunkKey(tgId, tripId, seq), body, {
        sha256,
        rows: String(info.rows),
        firstTs: String(info.firstTs),
        lastTs: String(info.lastTs)
      })
    }
    const fuelRateSource = samples.some((s) => s.fuelRateLph !== undefined) ? "pid_5e" : "none"
    const manifest: TripManifest = {
      formatVersion: 1,
      tripId,
      status: "finished",
      startedAt: first.ts,
      endedAt: last.ts,
      chunkCount: chunks.length,
      chunks,
      gaps: [],
      supportedPids: [],
      device: { appVersion: "import", userAgent: "telegram-document-import", transport: "serial" },
      fuelRateSource,
      note: `import: ${fileName}`.slice(0, 200)
    }
    yield* put("car.import.manifest", manifestKey(tgId, tripId), JSON.stringify(manifest))
    return {
      tripId,
      points: samples.length,
      startedAt: first.ts,
      metrics: analyzeTrip(samples, [], fuelRateSource)
    } satisfies ImportResult
  })

export interface DocumentLike {
  readonly file_id: string
  readonly file_name?: string | undefined
  readonly mime_type?: string | undefined
  readonly file_size?: number | undefined
}

export const isCsvDocument = (doc: DocumentLike): boolean =>
  (doc.file_name ?? "").toLowerCase().endsWith(".csv") || doc.mime_type === "text/csv"

export interface ImportContext {
  readonly tgId: TgId
  readonly chatId: ChatId
  readonly threadId: ThreadId | undefined
  readonly lang: Lang
}

const download = (fileId: string) =>
  Effect.gen(function*() {
    const tg = yield* Telegram
    const token = Redacted.value(yield* Config.Redacted("TELEGRAM_BOT_TOKEN"))
    const base = yield* Config.String("TELEGRAM_API_BASE").pipe(Config.withDefault("https://api.telegram.org"))
    const info = (yield* tg.call("getFile", { file_id: fileId })) as { readonly file_path?: string }
    if (info.file_path === undefined) return yield* Effect.fail(new Error("getFile returned no file_path"))
    const res = yield* Effect.tryPromise(() => fetch(`${base}/file/bot${token}/${info.file_path}`))
    if (!res.ok) return yield* Effect.fail(new Error(`download failed: ${res.status}`))
    const buf = yield* Effect.tryPromise(() => res.arrayBuffer())
    return new TextDecoder().decode(buf)
  })

/**
 * Hook for the dispatcher: a user sent a document. Returns false when it is not a CSV (not handled);
 * otherwise imports it and replies with a summary or a precise localized error.
 */
export const importDocument = (ctx: ImportContext, doc: DocumentLike) =>
  Effect.gen(function*() {
    if (!isCsvDocument(doc)) return false
    const tg = yield* Telegram
    const m = messages[ctx.lang]
    const to = ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId }
    const reply = (html: string) => tg.sendMessage(to, html).pipe(Effect.asVoid)
    if ((doc.file_size ?? 0) > MAX_IMPORT_BYTES) {
      yield* reply(m.importTooBig)
      return true
    }
    const text = yield* download(doc.file_id).pipe(Effect.result)
    if (text._tag === "Failure") {
      yield* reply(m.importDownload)
      return true
    }
    if (text.success.length > MAX_IMPORT_BYTES) {
      yield* reply(m.importTooBig)
      return true
    }
    const stored = yield* storeImport(ctx.tgId, text.success, doc.file_name ?? "file.csv").pipe(Effect.result)
    if (stored._tag === "Failure") {
      const e = stored.failure
      yield* reply(
        e._tag === "CsvParseError"
          ? m.importBad(e.line, escapeHtml(e.message))
          : e._tag === "EmptyImport"
            ? m.importEmpty
            : m.importStorage
      )
      return true
    }
    const r = stored.success
    const km = r.metrics.distanceKm
    yield* reply(
      m.importOk(
        formatStamp(r.startedAt),
        formatDuration(r.metrics.durationSeconds, ctx.lang),
        km === undefined ? "" : m.importDistance(formatKm(km, ctx.lang)),
        r.points
      )
    )
    return true
  }).pipe(Effect.mapError((e) => (e instanceof StorageError || (e as { _tag?: string })._tag === "TelegramError" ? e : new StorageError({ operation: "car.import", cause: e }))))

