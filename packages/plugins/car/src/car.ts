import { Clock, Config, Context, Effect, Layer, Schema } from "effect"
import { table } from "@bot/telegram-format/format"
import { chunkKey, manifestKey } from "@bot/car-format/layout"
import type { CallbackDef, CommandContext, CommandDef } from "@bot/core-contracts/commands"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import type { AgentTool, BotPlugin } from "@bot/core-contracts/plugin"
import { Telegram } from "@bot/core-contracts/telegram"
import type { InlineKeyboard, SendTarget } from "@bot/core-contracts/telegram"
import { METRIC_NAMES, combineMetrics, type TripMetrics } from "./analytics.ts"
import { DEVICE_CALLBACK_PREFIX, listDevices, PAIR_TTL_SECONDS, pairUrl, revokeDevice, startPair } from "./devices.ts"
import { CarBackend } from "@bot/car-store/backend"
import { insightTools } from "./insight-tools.ts"
import { ensureWeekly, weeklyJob } from "./notify.ts"
import { CarKv } from "./kv.ts"
import { CarWebUrl } from "./web-url.ts"
import { escapeHtml, formatDuration, formatKm, formatStamp, messages } from "./messages.ts"
import { parsePeriod } from "./period.ts"
import { DEFAULT_UPLOAD_TTL_SECONDS, Presigner, layerConfig } from "./presigner.ts"
import { CarBucket } from "./r2.ts"
import { listOverview, parseTripId, tripIdTime, tripMetrics, tripStatus, type TripOverview } from "./trip-store.ts"
import { headTrip, isValidExt, newUploadKey, prefixOf } from "./trips.ts"

export { CarWebUrl }

export type CarR = CarBucket | Presigner | Telegram | CarKv | CarWebUrl | CarBackend

const target = (ctx: {
  readonly chatId: SendTarget["chatId"]
  readonly threadId: SendTarget["threadId"] | undefined
}): SendTarget => (ctx.threadId === undefined ? { chatId: ctx.chatId } : { chatId: ctx.chatId, threadId: ctx.threadId })

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

const uploadLink = (tgId: TgId, ext: string) =>
  Effect.gen(function* () {
    const presigner = yield* Presigner
    const now = yield* Clock.currentTimeMillis
    const key = newUploadKey(tgId, new Date(now), ext)
    const url = yield* presigner.presignPut(key, DEFAULT_UPLOAD_TTL_SECONDS)
    return { key, url, expiresInSeconds: DEFAULT_UPLOAD_TTL_SECONDS }
  })

const startedAtOf = (o: TripOverview) => o.status.manifest?.startedAt ?? tripIdTime(o.tripId)

const tripLine = (o: TripOverview, lang: Lang): string => {
  const m = messages[lang]
  const man = o.status.manifest
  const date = formatStamp(startedAtOf(o))
  if (man === null || man.status !== "finished") return m.tripRecording(date)
  if (!o.status.complete) return m.tripPartial(date, o.status.received.length, man.chunkCount)
  const seconds = ((man.endedAt ?? man.startedAt) - man.startedAt) / 1000
  return m.tripOk(date, formatDuration(seconds, lang), o.status.rows)
}

const REPORT_TRIPS = 30
const num1 = (v: number | undefined, digits = 1) => (v === undefined ? "-" : v.toFixed(digits))

const sendApp = (ctx: CommandContext) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    const m = messages[ctx.lang]
    const webUrl = yield* CarWebUrl
    if (webUrl === "") return yield* tg.sendMessage(target(ctx), m.appNotConfigured).pipe(Effect.asVoid)
    const { code } = yield* startPair({ tgId: ctx.tgId, firstName: "", lang: ctx.lang })
    yield* ensureWeekly(ctx.tgId)
    const keyboard: InlineKeyboard = [[{ text: m.openApp, url: pairUrl(webUrl, code) }]]
    yield* tg.sendMessage(target(ctx), m.appText, { keyboard }).pipe(Effect.asVoid)
  })

const sendDevices = (ctx: CommandContext) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    const m = messages[ctx.lang]
    const devices = yield* listDevices(ctx.tgId)
    if (devices.length === 0) return yield* tg.sendMessage(target(ctx), m.devicesNone).pipe(Effect.asVoid)
    const lines = devices.map((d) =>
      m.deviceLine(
        escapeHtml(d.name),
        formatStamp(d.createdAt),
        d.lastSeenAt === null ? m.deviceNever : formatStamp(d.lastSeenAt)
      )
    )
    const keyboard: InlineKeyboard = devices.map((d) => [
      { text: m.revoke(d.name), callbackData: `${DEVICE_CALLBACK_PREFIX}:${d.deviceId}`, style: "danger" as const }
    ])
    yield* tg
      .sendMessage(target(ctx), [m.devicesHeader(devices.length), ...lines].join("\n"), { keyboard })
      .pipe(Effect.asVoid)
  })

const sendReport = (ctx: CommandContext, periodArg: string | undefined) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    const m = messages[ctx.lang]
    const now = new Date(yield* Clock.currentTimeMillis)
    const period = parsePeriod(periodArg, now)
    if (period === undefined) return yield* tg.sendMessage(target(ctx), m.badPeriod).pipe(Effect.asVoid)
    const all = yield* listOverview(ctx.tgId, { from: period.from, to: period.to, limit: 1000 })
    const complete = all.filter((o) => o.status.complete)
    const shown = complete.slice(0, REPORT_TRIPS)
    const skipped = all.length - complete.length
    const lines = [m.reportHeader(escapeHtml(period.label))]
    if (shown.length === 0) {
      lines.push(m.reportEmpty)
      if (skipped > 0) lines.push(m.reportSkipped(skipped))
      return yield* tg.sendMessage(target(ctx), lines.join("\n")).pipe(Effect.asVoid)
    }
    const metrics: Array<TripMetrics> = []
    const rows: Array<Array<string>> = []
    for (const o of shown) {
      const tm = yield* tripMetrics(ctx.tgId, o.tripId, o.status)
      if (tm === undefined) continue
      metrics.push(tm)
      rows.push([
        formatStamp(startedAtOf(o)).slice(5),
        formatDuration(tm.durationSeconds, ctx.lang),
        num1(tm.distanceKm),
        num1(tm.avgSpeedKmh, 0),
        num1(tm.maxSpeedKmh, 0),
        tm.fuelPer100Km === undefined ? "-" : `${num1(tm.fuelPer100Km)}${tm.fuelIsEstimate ? "*" : ""}`
      ])
    }
    const total = combineMetrics(metrics)
    rows.push([
      m.reportTotal,
      formatDuration(total.durationSeconds, ctx.lang),
      num1(total.distanceKm),
      num1(total.avgSpeedKmh, 0),
      num1(total.maxSpeedKmh, 0),
      total.fuelPer100Km === undefined ? "-" : `${num1(total.fuelPer100Km)}${total.fuelIsEstimate ? "*" : ""}`
    ])
    const unit = ctx.lang === "ru" ? "л" : "L"
    lines.push(
      table(m.reportColumns.split("|"), rows).pre,
      m.reportSummary(
        total.trips,
        formatDuration(total.durationSeconds, ctx.lang),
        formatKm(total.distanceKm, ctx.lang),
        formatDuration(total.idleSeconds, ctx.lang),
        total.fuelLiters === undefined ? "" : m.reportFuel(`${num1(total.fuelLiters)} ${unit}`),
        total.avgCoolantC === undefined ? "" : m.reportCoolant(`${num1(total.avgCoolantC, 0)} °C`)
      )
    )
    if (total.fuelIsEstimate) lines.push(m.reportEstimate)
    if (skipped > 0) lines.push(m.reportSkipped(skipped))
    if (complete.length > shown.length) lines.push(m.reportTruncated(shown.length))
    yield* tg.sendMessage(target(ctx), lines.join("\n")).pipe(Effect.asVoid)
  })

const carCommand: CommandDef<CarR> = {
  name: "car",
  role: "user",
  description: { en: messages.en.description, ru: messages.ru.description },
  usage: { en: messages.en.usage, ru: messages.ru.usage },
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const m = messages[ctx.lang]
      const [sub = "", ...rest] = ctx.args.trim().split(/\s+/)
      const send = (html: string) => tg.sendMessage(target(ctx), html).pipe(Effect.asVoid)

      switch (sub.toLowerCase()) {
        case "":
        case "app":
          return yield* sendApp(ctx)
        case "devices":
          return yield* sendDevices(ctx)
        case "upload": {
          const ext = rest[0] ?? "bin"
          if (!isValidExt(ext)) return yield* send(m.badExt)
          const link = yield* uploadLink(ctx.tgId, ext)
          return yield* send(m.uploadLink(escapeHtml(link.url), link.expiresInSeconds / 60))
        }
        case "trips": {
          const trips = yield* listOverview(ctx.tgId, { limit: 20 })
          if (trips.length === 0) return yield* send(m.noTrips)
          return yield* send([m.tripsHeader(trips.length), ...trips.map((t) => tripLine(t, ctx.lang))].join("\n"))
        }
        case "report":
          return yield* sendReport(ctx, rest[0])
        default:
          return yield* send(m.help)
      }
    })
}

const revokeCallback: CallbackDef<CarR> = {
  prefix: DEVICE_CALLBACK_PREFIX,
  role: "user",
  handler: (ctx) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const m = messages[ctx.lang]
      const done = yield* revokeDevice(ctx.tgId, ctx.payload)
      yield* tg.answerCallbackQuery(ctx.callbackId, done ? m.revoked : m.revokeNotFound)
    })
}

const ListInput = Schema.Struct({
  from: Schema.optionalKey(Schema.String.annotate({ description: "ISO date/time, inclusive" })),
  to: Schema.optionalKey(Schema.String.annotate({ description: "ISO date/time, exclusive" })),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })))
})
const GetInput = Schema.Struct({
  tripId: Schema.optionalKey(Schema.String.annotate({ description: "Trip id from car_list_trips" })),
  key: Schema.optionalKey(
    Schema.String.annotate({ description: "Raw uploaded file key (car/<id>/...) from car_list_trips.uploads" })
  )
})
const QueryInput = Schema.Struct({
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
  metric: Schema.optionalKey(Schema.String.annotate({ description: `One of: ${METRIC_NAMES.join(", ")}` }))
})
const UploadInput = Schema.Struct({ ext: Schema.optionalKey(Schema.String) })
const AppLinkInput = Schema.Struct({})

const QUERY_TRIPS_LIMIT = 40
const GET_TTL = 600

const iso = (ms: number) => new Date(ms).toISOString()

const tools: ReadonlyArray<AgentTool<CarR>> = [
  ...insightTools,
  {
    name: "car_list_trips",
    description:
      "List the user's recorded car trips (newest first) with completeness flag, plus raw uploaded files (not trips).",
    input: ListInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const input = raw as typeof ListInput.Type
        const from = yield* parseInstant("car_list_trips", input.from)
        const to = yield* parseInstant("car_list_trips", input.to)
        const trips = yield* listOverview(ctx.tgId, { from, to, limit: input.limit ?? 50 })
        const bucket = yield* CarBucket
        const prefix = prefixOf(ctx.tgId)
        const root = yield* Effect.tryPromise({
          try: () => bucket.list({ prefix, delimiter: "/" }),
          catch: (cause) => new StorageError({ operation: "car.list-uploads", cause })
        })
        return {
          trips: trips.map((o) => {
            const man = o.status.manifest
            return {
              tripId: o.tripId,
              startedAt: iso(startedAtOf(o)),
              endedAt: man?.endedAt === undefined ? null : iso(man.endedAt),
              recording: man === null || man.status !== "finished",
              complete: o.status.complete,
              chunks: {
                received: o.status.received.length,
                missing: o.status.missing,
                corrupt: o.status.corrupt,
                total: man?.chunkCount ?? null
              },
              points: o.status.rows,
              fuelRateSource: man?.fuelRateSource ?? null,
              note: man?.note ?? null
            }
          }),
          uploads: root.objects
            .filter((o) => o.key.startsWith(prefix))
            .map((o) => ({ key: o.key, sizeBytes: o.size, uploaded: o.uploaded.toISOString() }))
        }
      })
  },
  {
    name: "car_get_trip",
    description:
      "One trip: manifest, status, computed metrics and short-lived presigned GET URLs (manifest + every chunk CSV) to curl in the sandbox. With `key` instead: a presigned URL for a raw uploaded file.",
    input: GetInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const input = raw as typeof GetInput.Type
        const presigner = yield* Presigner
        if (input.key !== undefined) {
          const trip = yield* headTrip(ctx.tgId, input.key).pipe(mapKeyError("car_get_trip"))
          if (trip === undefined) return { found: false }
          return {
            found: true,
            trip,
            downloadUrl: yield* presigner.presignGet(input.key, GET_TTL),
            expiresInSeconds: GET_TTL
          }
        }
        const tripId = input.tripId === undefined ? undefined : parseTripId(input.tripId)
        if (tripId === undefined) return yield* fail("car_get_trip", "tripId (from car_list_trips) or key is required")
        const status = yield* tripStatus(ctx.tgId, tripId)
        if (status.manifest === null) return { found: false }
        const metrics = yield* tripMetrics(ctx.tgId, tripId, status)
        const manifestUrl = yield* presigner.presignGet(manifestKey(ctx.tgId, tripId), GET_TTL)
        const chunks = []
        for (const seq of status.received) {
          chunks.push({ seq, url: yield* presigner.presignGet(chunkKey(ctx.tgId, tripId, seq), GET_TTL) })
        }
        return {
          found: true,
          tripId,
          complete: status.complete,
          missing: status.missing,
          corrupt: status.corrupt,
          manifest: status.manifest,
          metrics,
          manifestUrl,
          chunks,
          csvColumns:
            "ts,lat,lon,gps_accuracy_m,gps_speed_kmh,speed_kmh,rpm,coolant_c,intake_c,load_pct,throttle_pct,maf_gps,map_kpa,fuel_rate_lph,fuel_level_pct,voltage_v",
          expiresInSeconds: GET_TTL
        }
      })
  },
  {
    name: "car_query",
    description: `Aggregates over trips in a period: per-trip metrics and totals. metric (optional) selects one of: ${METRIC_NAMES.join(", ")}.`,
    input: QueryInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const input = raw as typeof QueryInput.Type
        const from = yield* parseInstant("car_query", input.from)
        const to = yield* parseInstant("car_query", input.to)
        if (input.metric !== undefined && !(METRIC_NAMES as ReadonlyArray<string>).includes(input.metric)) {
          return {
            available: false,
            reason: `Unknown metric. Use one of: ${METRIC_NAMES.join(", ")}`,
            metrics: METRIC_NAMES
          }
        }
        const all = yield* listOverview(ctx.tgId, { from, to, limit: 1000 })
        const complete = all.filter((o) => o.status.complete).slice(0, QUERY_TRIPS_LIMIT)
        const perTrip: Array<{ readonly tripId: string; readonly startedAt: string; readonly metrics: TripMetrics }> =
          []
        for (const o of complete) {
          const metrics = yield* tripMetrics(ctx.tgId, o.tripId, o.status)
          if (metrics !== undefined) perTrip.push({ tripId: o.tripId, startedAt: iso(startedAtOf(o)), metrics })
        }
        const base = {
          trips: all.length,
          completeTrips: all.filter((o) => o.status.complete).length,
          incompleteTrips: all.filter((o) => !o.status.complete).length,
          analyzedTrips: perTrip.length,
          totals: combineMetrics(perTrip.map((t) => t.metrics)),
          metrics: METRIC_NAMES
        }
        if (input.metric === undefined) return { ...base, perTrip }
        const key = input.metric as (typeof METRIC_NAMES)[number]
        const values = perTrip.flatMap((t) => (t.metrics[key] === undefined ? [] : [t.metrics[key] as number]))
        const sum = values.reduce((a, b) => a + b, 0)
        return {
          ...base,
          metric: {
            name: key,
            trips: values.length,
            sum,
            avg: values.length === 0 ? null : sum / values.length,
            min: values.length === 0 ? null : Math.min(...values),
            max: values.length === 0 ? null : Math.max(...values),
            perTrip: perTrip.map((t) => ({ tripId: t.tripId, value: t.metrics[key] ?? null }))
          }
        }
      })
  },
  {
    name: "car_app_link",
    description:
      "Create a one-time link (valid 30 minutes) that opens the car recorder app in Chrome on the user's Android phone and connects that phone to this account. Use it whenever the user wants to record a trip, connect a phone or upload car data.",
    input: AppLinkInput,
    handler: (_raw, ctx) =>
      Effect.gen(function* () {
        const webUrl = yield* CarWebUrl
        if (webUrl === "") return yield* fail("car_app_link", "CAR_WEB_URL is not configured")
        const { code } = yield* startPair({ tgId: ctx.tgId, firstName: "", lang: ctx.lang ?? "en" })
        return {
          url: pairUrl(webUrl, code),
          expiresInMinutes: PAIR_TTL_SECONDS / 60,
          instructions:
            "Give the user this link as is. It must be opened in Chrome on Android (Telegram's in-app browser will offer an 'Open in Chrome' button). It works once; for a new phone or an expired link call this tool again."
        }
      })
  },
  {
    name: "car_upload_link",
    description:
      "Create a presigned PUT URL (valid 15 minutes) for uploading a raw file with an HTTP client such as curl. Not for people on a phone: for recording or uploading trips use car_app_link.",
    input: UploadInput,
    handler: (raw, ctx) =>
      Effect.gen(function* () {
        const ext = (raw as typeof UploadInput.Type).ext ?? "bin"
        if (!isValidExt(ext)) return yield* fail("car_upload_link", "ext must be 1-10 letters or digits")
        return yield* uploadLink(ctx.tgId, ext)
      })
  }
]

const systemPrompt = `Car data plugin. The user records trips with the car app (OBD-II adapter + phone).
First step, always: whenever the user talks about their car in any way (a breakdown, a warning light, a noise, fuel use, the battery, or just "help with my car"), call car_overview before answering. If it shows no trips and no fault-code scan yet, do not only ask about symptoms. Say briefly that you can read the car's own diagnostics (fault codes, battery health, fuel use, trips) with a small Bluetooth OBD-II adapter that plugs in under the steering wheel (an "ELM327 Bluetooth LE" adapter, usually 10-20 dollars). Before sending any link, ask what phone they have: recording works only on an Android phone with Chrome. On an iPhone the recorder does not work, so say so honestly and do not send the link; offer to help with the fault from their description, a photo of the warning light or an error code they read elsewhere. On Android, call car_app_link and give the link, saying it opens in Chrome and guides them step by step. Always tell them plainly, in one short sentence, how recording works: the app must stay open with the screen on while driving (a phone holder with a charger is best), because Chrome cannot record in the background; the app starts and stops each trip by itself. After that, also ask what is wrong so you can help right away from their description. If there is data, answer from it. The server already computes trip insights, alerts, battery and fault-code explanations deterministically; you answer free-form questions on top of that. Prefer these tools:
- car_overview {}: totals, weekly/monthly stats, battery status and trend, engine status with explained fault codes, open alerts. Start here for questions about the car's condition.
- car_sql {query}: one read-only SELECT/WITH over the user's car_* tables (trips, samples, battery events, fault code history, alerts) for exact numbers, trends and comparisons. The table schema is in the tool description. Always use it instead of downloading CSVs for aggregates.
- car_dtc {}: current fault codes with explanations, severity and advice.
Older tools, use them only when the above cannot answer:
- car_list_trips {from?, to?, limit?}: trips newest first (tripId, complete flag, chunk counts, points) plus raw uploads.
- car_get_trip {tripId}: manifest, computed metrics and presigned GET URLs for the manifest and every chunk CSV (curl them in the sandbox, concatenate chunks in seq order). {key} for a raw uploaded file.
- car_query {from?, to?, metric?}: real aggregates (distance, duration, avg/max speed, idle time, fuel, L/100km, coolant). metrics: ${METRIC_NAMES.join(", ")}.
- car_app_link {}: one-time 30-minute link that opens the recorder app in Chrome and connects the phone. Use it when the user wants to record a trip or get data into the bot. Users can also send a CSV file to the chat as a document.
- car_upload_link {ext?}: raw presigned PUT URL for HTTP clients (curl); never give it to a person as a way to upload from a phone.
Data layout: R2 car/<tgId>/trips/<tripId>/manifest.json + chunks/000000.csv ...; imported files in car/<tgId>/imports/. Only the user's own prefix is reachable.
CSV columns (header row, missing value = empty cell, never zero): ts (epoch ms), lat, lon, gps_accuracy_m, gps_speed_kmh, speed_kmh (OBD 0D), rpm, coolant_c, intake_c, load_pct, throttle_pct, maf_gps, map_kpa, fuel_rate_lph, fuel_level_pct, voltage_v.
Rules: analyse segments separately; never interpolate across manifest.gaps or time jumps over 10 s. Distance: integrate speed_kmh, fall back to GPS haversine. Fuel is an estimate when manifest.fuelRateSource = "maf_estimate". Only complete trips are fully reliable; mention incomplete ones.
Use Python in the sandbox (pandas, matplotlib) only to draw charts: fetch the numbers with car_sql, then plot and save PNGs under /workspace/out/. Do not use Python for aggregates car_sql can compute.
The user is not technical: explain in plain language, give the numbers, say what to do.`

const pass = <I, S>(tag: Context.Service<I, S>): Layer.Layer<I, never, I> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      return yield* tag
    }) as Effect.Effect<S, never, I>
  )

const webUrlLayer = Layer.effect(CarWebUrl, Config.String("CAR_WEB_URL").pipe(Config.withDefault("")))

export const layer: Layer.Layer<CarR, Config.ConfigError, CarBucket | Telegram | CarKv | CarBackend> = Layer.mergeAll(
  layerConfig,
  webUrlLayer,
  pass(CarBucket),
  pass(Telegram),
  pass(CarKv),
  pass(CarBackend)
)

export const carPlugin: BotPlugin<CarR, Config.ConfigError, CarBucket | Telegram | CarKv | CarBackend> = {
  id: "car",
  title: { en: "Car analytics", ru: "Аналитика машины" },
  blurb: {
    en: "diagnose car faults and warnings, and track fuel use, battery and trips (needs a small Bluetooth adapter plugged into the car)",
    ru: "разбирать ошибки и поломки машины, следить за расходом, аккумулятором и поездками (нужен маленький Bluetooth-адаптер в разъём машины)"
  },
  commands: [carCommand],
  callbacks: [revokeCallback],
  tools,
  jobs: [weeklyJob],
  layer,
  systemPrompt,
  enabledByDefault: true
}
