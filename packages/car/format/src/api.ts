import { Schema } from "effect"
import { TripManifest } from "./manifest.ts"

export const ApiErrorCode = Schema.Literals([
  "unauthorized",
  "pair_code_invalid",
  "forbidden",
  "plugin_disabled",
  "bad_request",
  "checksum_mismatch",
  "chunk_conflict",
  "too_large",
  "not_found",
  "rate_limited",
  "internal"
])
export type ApiErrorCode = typeof ApiErrorCode.Type

export const ApiError = Schema.Struct({
  error: Schema.Struct({ code: ApiErrorCode, message: Schema.String, retryable: Schema.Boolean })
})
export type ApiError = typeof ApiError.Type

export const Me = Schema.Struct({
  tgId: Schema.Int,
  firstName: Schema.String,
  lang: Schema.Literals(["ru", "en"]),
  pluginEnabled: Schema.Boolean,
  serverTime: Schema.Number
})
export type Me = typeof Me.Type

export const ManifestReceipt = Schema.Struct({ ok: Schema.Literal(true) })

export const ChunkReceipt = Schema.Struct({
  seq: Schema.Int,
  stored: Schema.Literals(["new", "already"]),
  sha256: Schema.String
})
export type ChunkReceipt = typeof ChunkReceipt.Type

export const TripStatus = Schema.Struct({
  tripId: Schema.String,
  manifest: Schema.NullOr(TripManifest),
  received: Schema.Array(Schema.Int),
  missing: Schema.Array(Schema.Int),
  corrupt: Schema.Array(Schema.Int),
  complete: Schema.Boolean,
  rows: Schema.Int
})
export type TripStatus = typeof TripStatus.Type

export const TripSummary = Schema.Struct({
  tripId: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.NullOr(Schema.Number),
  status: Schema.Literals(["recording", "finished"]),
  chunkCount: Schema.Int,
  received: Schema.Int,
  complete: Schema.Boolean
})
export const TripList = Schema.Struct({ trips: Schema.Array(TripSummary) })
export type TripList = typeof TripList.Type

export const PairCompleteRequest = Schema.Struct({ code: Schema.String, deviceName: Schema.String })
export const PairComplete = Schema.Struct({
  deviceToken: Schema.String,
  deviceId: Schema.String,
  tgId: Schema.Int,
  firstName: Schema.String
})
export type PairComplete = typeof PairComplete.Type

export const DeviceInfo = Schema.Struct({
  deviceId: Schema.String,
  name: Schema.String,
  createdAt: Schema.Number,
  lastSeenAt: Schema.NullOr(Schema.Number)
})
export const DeviceList = Schema.Struct({ devices: Schema.Array(DeviceInfo) })
export type DeviceList = typeof DeviceList.Type
