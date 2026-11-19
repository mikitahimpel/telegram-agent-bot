import { Schema } from "effect"
import { TripManifest } from "./manifest.ts"

/**
 * HTTP API between the Mini App and the gateway Worker. Base path: `/car/api`.
 * The recorder runs only in Chrome (Web Bluetooth/Serial are not available in Android WebView,
 * so a Telegram in-app browser just shows "Open in Chrome").
 *
 * Auth: `Authorization: Device <deviceToken>` — long-lived, revocable (`/car devices`).
 * The user must be allowed and the car plugin enabled.
 *
 * Pairing: the bot's `/car app` creates a one-time code (10 min) and sends a URL button
 * `https://<host>/car/#pair=<code>`. Chrome → POST /car/api/pair/complete { code, deviceName }
 * (no auth) → PairComplete { deviceToken, ... }, stored in IndexedDB. Reused/expired → `pair_code_invalid`.
 * The bot then notifies: "New device connected: <deviceName>" with a revoke button.
 *
 *   GET  /car/api/me                                  → Me
 *   GET  /car/api/devices                             → DeviceList
 *   DELETE /car/api/devices/:deviceId                 → { ok: true }
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
  "unauthorized", // device token missing/revoked → pair again via /car app
  "pair_code_invalid", // pairing code expired or already used → get a new link from the bot
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
