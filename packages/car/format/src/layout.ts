import type { TripId } from "./manifest.ts"

export const accountPrefix = (tgId: number): string => `car/${tgId}/`
export const tripPrefix = (tgId: number, tripId: TripId): string => `car/${tgId}/trips/${tripId}/`
export const manifestKey = (tgId: number, tripId: TripId): string => `${tripPrefix(tgId, tripId)}manifest.json`
export const chunkKey = (tgId: number, tripId: TripId, seq: number): string =>
  `${tripPrefix(tgId, tripId)}chunks/${String(seq).padStart(6, "0")}.csv`
export const importKey = (tgId: number, tripId: TripId): string => `car/${tgId}/imports/${tripId}.csv`

export const MAX_CHUNK_BYTES = 512 * 1024
export const MAX_MANIFEST_BYTES = 256 * 1024
