import { Clock, Config, Context, Effect, Layer, Schema } from "effect"
import type { CommandContext, CommandDef } from "@bot/core-contracts/commands"
import { StorageError } from "@bot/core-contracts/errors"
import type { BotPlugin, AgentTool } from "@bot/core-contracts/plugin"
import { Telegram } from "@bot/core-contracts/telegram"
import type { SendTarget } from "@bot/core-contracts/telegram"
import { escapeHtml, formatBytes, messages } from "./messages.ts"
import { parsePeriod } from "./period.ts"
import { DEFAULT_UPLOAD_TTL_SECONDS, Presigner, layerConfig } from "./presigner.ts"
import { CarBucket } from "./r2.ts"
import { TripParser, layerUnknownFormat } from "./trip-parser.ts"
import {
  aggregate,
  headTrip,
  isValidExt,
  listTrips,
  newUploadKey,
  readTripBytes
} from "./trips.ts"
import type { TgId } from "@bot/core-contracts/ids"

export type CarR = CarBucket | Presigner | TripParser | Telegram

const target = (ctx: CommandContext): SendTarget =>
  ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId }

const fail = (operation: string, message: string) => new StorageError({ operation, cause: new Error(message) })

const parseInstant = (operation: string, text: string | undefined) => {
  if (text === undefined) return Effect.succeed(undefined)
  const t = Date.parse(text)
  return Number.isNaN(t) ? Effect.fail(fail(operation, `Invalid date: ${text}`)) : Effect.succeed(new Date(t))
}

const mapKeyError = (operation: string) =>
  Effect.mapError((e: { readonly _tag: string; readonly message: string }) =>
    e._tag === "InvalidTripKey" ? fail(operation, e.message) : (e as never as StorageError)
  )

const shortName = (key: string) => key.slice(key.lastIndexOf("/") + 1)
const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`

const uploadLink = (tgId: TgId, ext: string) =>
  Effect.gen(function*() {
    const presigner = yield* Presigner
    const now = yield* Clock.currentTimeMillis
    const key = newUploadKey(tgId, new Date(now), ext)
    const url = yield* presigner.presignPut(key, DEFAULT_UPLOAD_TTL_SECONDS)
    return { key, url, expiresInSeconds: DEFAULT_UPLOAD_TTL_SECONDS }
  })

const carCommand: CommandDef<CarR> = {
  name: "car",
  role: "user",
  description: { en: messages.en.description, ru: messages.ru.description },
  usage: { en: messages.en.usage, ru: messages.ru.usage },
  handler: (ctx) =>
    Effect.gen(function*() {
      const tg = yield* Telegram
      const m = messages[ctx.lang]
      const [sub = "", ...rest] = ctx.args.trim().split(/\s+/)
      const send = (html: string) => tg.sendMessage(target(ctx), html).pipe(Effect.asVoid)

      switch (sub.toLowerCase()) {
        case "upload": {
          const ext = rest[0] ?? "bin"
          if (!isValidExt(ext)) return yield* send(m.badExt)
          const link = yield* uploadLink(ctx.tgId, ext)
          return yield* send(m.uploadLink(escapeHtml(link.url), link.expiresInSeconds / 60))
        }
        case "trips": {
          const trips = yield* listTrips(ctx.tgId, { limit: 20 })
          if (trips.length === 0) return yield* send(m.noTrips)
          const lines = trips.map(
            (t) => `<code>${escapeHtml(shortName(t.key))}</code> - ${formatBytes(t.sizeBytes)} - ${stamp(t.uploaded)}`
          )
          return yield* send([m.tripsHeader(trips.length), ...lines].join("\n"))
        }
        case "report": {
          const now = new Date(yield* Clock.currentTimeMillis)
          const period = parsePeriod(rest[0], now)
          if (period === undefined) return yield* send(m.badPeriod)
          const parser = yield* TripParser
          const trips = yield* listTrips(ctx.tgId, { from: period.from, to: period.to })
          const agg = aggregate(trips)
          const lines = [m.reportHeader(escapeHtml(period.label))]
          if (agg.count === 0) lines.push(m.reportEmpty)
          else {
            lines.push(m.reportTotals(agg.count, formatBytes(agg.totalBytes)))
            if (agg.perDay.length <= 31) {
              lines.push(...agg.perDay.map((d) => `${d.date}: ${d.count} / ${formatBytes(d.bytes)}`))
            }
          }
          if (!parser.known) lines.push("", m.reportNote)
          return yield* send(lines.join("\n"))
        }
        default:
          return yield* send(m.help)
      }
    })
}

const ListInput = Schema.Struct({
  from: Schema.optionalKey(Schema.String.annotate({ description: "ISO date/time, inclusive" })),
  to: Schema.optionalKey(Schema.String.annotate({ description: "ISO date/time, exclusive" })),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })))
})
const GetInput = Schema.Struct({ key: Schema.String.annotate({ description: "Trip key from car_list_trips" }) })
const QueryInput = Schema.Struct({
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
  metric: Schema.optionalKey(Schema.String.annotate({ description: "Parsed metric name (needs a known file format)" }))
})
const UploadInput = Schema.Struct({ ext: Schema.optionalKey(Schema.String) })

const METRIC_FILES_LIMIT = 50

const tools: ReadonlyArray<AgentTool<CarR>> = [
  {
    name: "car_list_trips",
    description: "List the user's uploaded car trip files (metadata only), newest first.",
    input: ListInput,
    handler: (raw, ctx) =>
      Effect.gen(function*() {
        const input = raw as typeof ListInput.Type
        const from = yield* parseInstant("car_list_trips", input.from)
        const to = yield* parseInstant("car_list_trips", input.to)
        const trips = yield* listTrips(ctx.tgId, { from, to, limit: input.limit ?? 50 })
        return { trips }
      })
  },
  {
    name: "car_get_trip",
    description:
      "Get metadata and a short-lived presigned download URL for one trip file. Download it in the sandbox with curl.",
    input: GetInput,
    handler: (raw, ctx) =>
      Effect.gen(function*() {
        const { key } = raw as typeof GetInput.Type
        const trip = yield* headTrip(ctx.tgId, key).pipe(mapKeyError("car_get_trip"))
        if (trip === undefined) return { found: false }
        const ttl = 600
        const url = yield* (yield* Presigner).presignGet(key, ttl)
        return { found: true, trip, downloadUrl: url, expiresInSeconds: ttl }
      })
  },
  {
    name: "car_query",
    description:
      "Aggregates over trip files in a period: counts and sizes from metadata; parsed metrics when the file format is known.",
    input: QueryInput,
    handler: (raw, ctx) =>
      Effect.gen(function*() {
        const input = raw as typeof QueryInput.Type
        const from = yield* parseInstant("car_query", input.from)
        const to = yield* parseInstant("car_query", input.to)
        const trips = yield* listTrips(ctx.tgId, { from, to })
        const base = { aggregate: aggregate(trips) }
        if (input.metric === undefined) return base
        const parser = yield* TripParser
        const values: Array<number> = []
        for (const trip of trips.slice(0, METRIC_FILES_LIMIT)) {
          const bytes = yield* readTripBytes(ctx.tgId, trip.key).pipe(mapKeyError("car_query"))
          if (bytes === undefined) continue
          const parsed = yield* parser.parse({ key: trip.key, bytes }).pipe(Effect.result)
          if (parsed._tag === "Failure") {
            return { ...base, metric: { available: false, reason: parsed.failure.message } }
          }
          const v = parsed.success.metrics[input.metric]
          if (v !== undefined) values.push(v)
        }
        const sum = values.reduce((a, b) => a + b, 0)
        return {
          ...base,
          metric: {
            available: true,
            name: input.metric,
            files: values.length,
            sum,
            avg: values.length === 0 ? null : sum / values.length,
            min: values.length === 0 ? null : Math.min(...values),
            max: values.length === 0 ? null : Math.max(...values)
          }
        }
      })
  },
  {
    name: "car_upload_link",
    description: "Create a presigned PUT URL (valid 15 minutes) for the user to upload a trip file.",
    input: UploadInput,
    handler: (raw, ctx) =>
      Effect.gen(function*() {
        const ext = (raw as typeof UploadInput.Type).ext ?? "bin"
        if (!isValidExt(ext)) return yield* fail("car_upload_link", "ext must be 1-10 letters or digits")
        return yield* uploadLink(ctx.tgId, ext)
      })
  }
]

const systemPrompt = `Car data plugin. The user uploads trip files (from their car's OBD logger) which you can reach with these tools:
- car_list_trips {from?, to?, limit?}: list trip files (metadata), newest first.
- car_get_trip {key}: metadata plus a short-lived presigned download URL. Download it into the sandbox with curl.
- car_query {from?, to?, metric?}: aggregates over a period (counts, sizes; parsed metrics only once the file format is supported).
- car_upload_link {ext?}: a 15-minute upload URL to give to the user.
Heavy analytics belongs in the sandbox: download the files via the presigned URLs and analyze them with python/duckdb. Return results as tables and save charts as PNG files under /workspace/out/. Only keys under the user's own car/ prefix are accessible; never guess other keys.`

const pass = <I, S>(tag: Context.Service<I, S>): Layer.Layer<I, never, I> =>
  Layer.effect(tag, Effect.gen(function*() { return yield* tag }) as Effect.Effect<S, never, I>)

export const layer: Layer.Layer<CarR, Config.ConfigError, CarBucket | Telegram> = Layer.mergeAll(
  layerUnknownFormat,
  layerConfig,
  pass(CarBucket),
  pass(Telegram)
)

export const carPlugin: BotPlugin<CarR, Config.ConfigError, CarBucket | Telegram> = {
  id: "car",
  title: { en: "Car analytics", ru: "Аналитика машины" },
  commands: [carCommand],
  callbacks: [],
  tools,
  layer,
  systemPrompt,
  enabledByDefault: false
}
