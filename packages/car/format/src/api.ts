import { Schema } from "effect"
import { TripManifest } from "./manifest.ts"

/**
 * HTTP API between the Mini App and the gateway Worker. Base path: `/car/api`.
 * Auth: header `Authorization: tma <Telegram.WebApp.initData>` (validated server-side
 * with the bot token, max age 24h). The user must be allowed and the car plugin enabled.
 *
 *   GET  /car/api/me                                  → Me
 *   PUT  /car/api/trips/:tripId/manifest              body TripManifest (JSON)      → ManifestReceipt
 *   PUT  /car/api/trips/:tripId/chunks/:seq           body CSV, header `X-Content-SHA256` → ChunkReceipt
 *   GET  /car/api/trips/:tripId/status                → TripStatus
 *   POST /car/api/trips/:tripId/finish                → TripStatus (+ bot message to the user)
 *   GET  /car/api/trips?limit=50                      → TripList
 *
 * All writes are idempotent: re-sending the same chunk (same sha256) returns `stored: "already"`.
 * Re-sending a chunk with a DIFFERENT sha256 for an existing seq fails with `chunk_conflict`
 * (the device must never rewrite history).
 */

export const ApiErrorCode = Schema.Literals([
  "unauthorized", // initData missing/invalid/expired → re-open the Mini App from the bot
  "forbidden", // not on allowlist
  "plugin_disabled", // admin has not enabled the car plugin for this account
  "bad_request",
  "checksum_mismatch", // body hash ≠ X-Content-SHA256 → corrupted in transit, retry
  "chunk_conflict", // same seq, different content already stored
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
  /** Server clock, to detect a wrong device clock. */
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

/**
 * Server view of one trip. `missing` = seqs in the manifest (0..chunkCount-1 when finished,
 * else manifest.chunks) without a stored object; `corrupt` = stored but hash/size differ.
 */
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
