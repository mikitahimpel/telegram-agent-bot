import type { TripId } from "./manifest.ts"

/**
 * R2 layout (all under the account prefix, never outside it):
 *   car/<tgId>/trips/<tripId>/manifest.json
 *   car/<tgId>/trips/<tripId>/chunks/000000.csv
 *   car/<tgId>/imports/<tripId>.csv          (file sent to the bot as a document — fallback path)
 * Chunk objects carry customMetadata { sha256, rows, firstTs, lastTs }.
 */
export const accountPrefix = (tgId: number): string => `car/${tgId}/`
export const tripPrefix = (tgId: number, tripId: TripId): string => `car/${tgId}/trips/${tripId}/`
export const manifestKey = (tgId: number, tripId: TripId): string => `${tripPrefix(tgId, tripId)}manifest.json`
export const chunkKey = (tgId: number, tripId: TripId, seq: number): string =>
  `${tripPrefix(tgId, tripId)}chunks/${String(seq).padStart(6, "0")}.csv`
export const importKey = (tgId: number, tripId: TripId): string => `car/${tgId}/imports/${tripId}.csv`

/** Max chunk body accepted by the API. Device targets ~30 s of samples per chunk (a few KB). */
export const MAX_CHUNK_BYTES = 512 * 1024
/** Max manifest body. */
export const MAX_MANIFEST_BYTES = 256 * 1024
