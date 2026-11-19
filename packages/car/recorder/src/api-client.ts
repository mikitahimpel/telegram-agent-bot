import { Context, Duration, Effect, Layer, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import {
  ApiError,
  ChunkReceipt,
  DeviceList,
  ManifestReceipt,
  Me,
  PairComplete,
  TripList,
  TripStatus
} from "@bot/car-format/api"
import { type DtcReport, PutDtcResponse } from "@bot/car-format/insights"
import type { TripManifest } from "@bot/car-format/manifest"
import { ApiFailure } from "./errors.ts"

export type Credential = {
  readonly token: string
}

export const authorizationHeader = (c: Credential): string => `Device ${c.token}`

export type CarApiShape = {
  readonly me: Effect.Effect<Me, ApiFailure>
  readonly putManifest: (manifest: TripManifest) => Effect.Effect<void, ApiFailure>
  readonly putChunk: (
    tripId: string,
    seq: number,
    csv: string,
    sha256: string
  ) => Effect.Effect<ChunkReceipt, ApiFailure>
  readonly putDtc: (report: DtcReport) => Effect.Effect<typeof PutDtcResponse.Type, ApiFailure>
  readonly status: (tripId: string) => Effect.Effect<TripStatus, ApiFailure>
  readonly finish: (tripId: string) => Effect.Effect<TripStatus, ApiFailure>
  readonly listTrips: (limit?: number) => Effect.Effect<TripList, ApiFailure>
  readonly pairComplete: (code: string, deviceName: string) => Effect.Effect<PairComplete, ApiFailure>
  readonly devices: Effect.Effect<DeviceList, ApiFailure>
  readonly revokeDevice: (deviceId: string) => Effect.Effect<void, ApiFailure>
  readonly credential: Effect.Effect<Credential | undefined>
  readonly setCredential: (c: Credential | undefined) => Effect.Effect<void>
}

export class CarApi extends Context.Service<CarApi, CarApiShape>()("@bot/car-recorder/CarApi") {}

export type CarApiOptions = {
  readonly apiBase: string
  readonly credential?: Credential | undefined
  readonly timeoutMs?: number
}

const OkBody = Schema.Struct({ ok: Schema.Literal(true) })

const statusFallback = (status: number): Pick<ApiFailure, "code" | "retryable"> => {
  if (status === 401) return { code: "unauthorized", retryable: false }
  if (status === 403) return { code: "forbidden", retryable: false }
  if (status === 404) return { code: "not_found", retryable: false }
  if (status === 409) return { code: "chunk_conflict", retryable: false }
  if (status === 413) return { code: "too_large", retryable: false }
  if (status === 429) return { code: "rate_limited", retryable: true }
  if (status >= 500) return { code: "internal", retryable: true }
  return { code: "bad_request", retryable: false }
}

export const makeCarApi = (options: CarApiOptions) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const credRef = yield* Ref.make<Credential | undefined>(options.credential)
    const base = options.apiBase.replace(/\/+$/, "")
    const timeout = Duration.millis(options.timeoutMs ?? 20_000)

    const failBody = (response: HttpClientResponse.HttpClientResponse) =>
      response.text.pipe(
        Effect.catch(() => Effect.succeed("")),
        Effect.flatMap((text) => {
          let json: unknown
          try {
            json = JSON.parse(text)
          } catch {
            json = undefined
          }
          return Schema.decodeUnknownEffect(ApiError)(json).pipe(
            Effect.match({
              onFailure: () => {
                const fb = statusFallback(response.status)
                return new ApiFailure({ ...fb, message: `HTTP ${response.status}`, status: response.status })
              },
              onSuccess: (b) =>
                new ApiFailure({
                  code: b.error.code,
                  retryable: b.error.retryable,
                  message: b.error.message,
                  status: response.status
                })
            }),
            Effect.flatMap((f) => Effect.fail(f))
          )
        })
      )

    const call = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
      build: (auth: Credential | undefined) => Effect.Effect<HttpClientRequest.HttpClientRequest, ApiFailure>,
      schema: S,
      options?: { readonly auth?: boolean }
    ): Effect.Effect<S["Type"], ApiFailure> =>
      Effect.gen(function* () {
        const cred = options?.auth === false ? undefined : yield* Ref.get(credRef)
        const req = yield* build(cred)
        const response = yield* http.execute(req).pipe(
          Effect.mapError(
            (e) => new ApiFailure({ code: "network", retryable: true, message: `Network error (${e.reason._tag})` })
          ),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new ApiFailure({ code: "timeout", retryable: true, message: "The server did not answer in time" })
              )
          })
        )
        if (response.status < 200 || response.status >= 300) return yield* failBody(response)
        const json = yield* response.json.pipe(
          Effect.mapError(
            () =>
              new ApiFailure({
                code: "internal",
                retryable: true,
                message: "Unreadable response",
                status: response.status
              })
          )
        )
        return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
          Effect.mapError(
            () =>
              new ApiFailure({
                code: "internal",
                retryable: true,
                message: "Unexpected response shape",
                status: response.status
              })
          )
        )
      })

    const authed = (req: HttpClientRequest.HttpClientRequest, cred: Credential | undefined) =>
      cred === undefined ? req : HttpClientRequest.setHeader(req, "Authorization", authorizationHeader(cred))

    const need = (cred: Credential | undefined): Effect.Effect<Credential, ApiFailure> =>
      cred === undefined
        ? Effect.fail(new ApiFailure({ code: "unauthorized", retryable: false, message: "No credential" }))
        : Effect.succeed(cred)
    const url = (path: string) => `${base}${path}`
    const id = (s: string) => encodeURIComponent(s)

    const get = (path: string) => (cred: Credential | undefined) =>
      need(cred).pipe(Effect.map((c) => authed(HttpClientRequest.get(url(path)), c)))

    const api: CarApiShape = {
      me: call(get("/me"), Me),
      putManifest: (m) =>
        call(
          (cred) =>
            need(cred).pipe(
              Effect.map((c) =>
                authed(HttpClientRequest.put(url(`/trips/${id(m.tripId)}/manifest`)), c).pipe(
                  HttpClientRequest.bodyJsonUnsafe(m)
                )
              )
            ),
          ManifestReceipt
        ).pipe(Effect.asVoid),
      putChunk: (tripId, seq, csv, sha256) =>
        call(
          (cred) =>
            need(cred).pipe(
              Effect.map((c) =>
                authed(HttpClientRequest.put(url(`/trips/${id(tripId)}/chunks/${seq}`)), c).pipe(
                  HttpClientRequest.setHeader("X-Content-SHA256", sha256),
                  HttpClientRequest.bodyText(csv, "text/csv")
                )
              )
            ),
          ChunkReceipt
        ),
      putDtc: (report) =>
        call(
          (cred) =>
            need(cred).pipe(
              Effect.map((c) =>
                authed(HttpClientRequest.put(url("/dtc")), c).pipe(HttpClientRequest.bodyJsonUnsafe(report))
              )
            ),
          PutDtcResponse
        ),
      status: (tripId) => call(get(`/trips/${id(tripId)}/status`), TripStatus),
      finish: (tripId) =>
        call(
          (cred) =>
            need(cred).pipe(Effect.map((c) => authed(HttpClientRequest.post(url(`/trips/${id(tripId)}/finish`)), c))),
          TripStatus
        ),
      listTrips: (limit = 50) => call(get(`/trips?limit=${limit}`), TripList),
      pairComplete: (code, deviceName) =>
        call(
          () =>
            Effect.succeed(
              HttpClientRequest.post(url("/pair/complete")).pipe(HttpClientRequest.bodyJsonUnsafe({ code, deviceName }))
            ),
          PairComplete,
          { auth: false }
        ),
      devices: call(get("/devices"), DeviceList),
      revokeDevice: (deviceId) =>
        call(
          (cred) =>
            need(cred).pipe(Effect.map((c) => authed(HttpClientRequest.delete(url(`/devices/${id(deviceId)}`)), c))),
          OkBody
        ).pipe(Effect.asVoid),
      credential: Ref.get(credRef),
      setCredential: (c) => Ref.set(credRef, c)
    }
    return api
  })

export const layer = (options: CarApiOptions): Layer.Layer<CarApi, never, HttpClient.HttpClient> =>
  Layer.effect(CarApi, makeCarApi(options))
