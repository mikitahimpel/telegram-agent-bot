import type { RecorderState } from "@bot/car-recorder/recorder"
import type { ChunkViewState, SyncState, SyncStatus, TripSync, TripSyncInfo } from "@bot/car-recorder/sync"
import type { Gap } from "@bot/car-format/manifest"
import type { AutoState } from "@bot/car-recorder/auto"
import type { AutoVm, ChunkState, ChunkVm, RecorderVm, SyncErrorCode, SyncGlobalVm, TripSyncVm, TripVm } from "../model/types.ts"

export const mapRecorderState = (s: RecorderState): RecorderVm => {
  switch (s._tag) {
    case "Idle":
      return { _tag: "Idle" }
    case "Recording":
      return {
        _tag: "Recording",
        tripId: s.tripId,
        startedAt: s.startedAt,
        points: s.points,
        chunks: s.chunks,
        distanceKm: s.distanceKm,
        lastSampleAt: s.lastSampleAt ?? s.startedAt,
        gapOpen: s.gapOpen,
        sourceEnded: s.sourceEnded,
        ...(s.storageError ? { storageError: s.storageError } : {})
      }
    case "Finishing":
      return { _tag: "Finishing" }
    case "Error":
      return { _tag: "Error", message: s.reason }
  }
}

export const mapSyncStatus = (s: SyncStatus): SyncGlobalVm => {
  switch (s._tag) {
    case "NeedsReauth":
      return { _tag: "NeedsReauth", reason: s.reason }
    case "Blocked":
      return { _tag: "Blocked", code: s.code }
    default:
      return { _tag: s._tag }
  }
}

export const mapSyncError = (raw: string): SyncErrorCode => {
  const r = raw.toLowerCase()
  if (/network|offline|fetch|timeout/.test(r)) return "network"
  if (/rate/.test(r) || r.includes("429")) return "rate_limited"
  if (/checksum/.test(r)) return "checksum_mismatch"
  if (/unauthori|401/.test(r)) return "unauthorized"
  if (/internal|server|5\d\d/.test(r)) return "server"
  return "unknown"
}

export const mapChunkState = (s: ChunkViewState): ChunkState => {
  switch (s) {
    case "pending":
      return "waiting"
    case "uploading":
      return "sent"
    default:
      return s
  }
}

const seqs = (chunks: ChunkVm[], st: ChunkState): number[] => chunks.filter((c) => c.state === st).map((c) => c.seq)
const lists = (n: number, found: number[]): number[] => (found.length >= n ? found : [...found, ...Array.from({ length: n - found.length }, (_, i) => i)].slice(0, n))

export const mapTripSync = (s: TripSync, chunks: ChunkVm[], now: number): TripSyncVm => {
  switch (s._tag) {
    case "Recording":
      return { _tag: "Recording" }
    case "Queued":
      return { _tag: "Queued" }
    case "Uploading":
      return { _tag: "Uploading", sent: s.sent, total: s.total, confirmed: s.confirmed }
    case "Waiting":
      return { _tag: "Waiting", sent: s.sent, total: s.total, nextRetryAt: s.nextRetryAt ?? now, lastError: mapSyncError(s.lastError), detail: s.lastError }
    case "Verifying":
      return { _tag: "Verifying" }
    case "Confirmed":
      return { _tag: "Confirmed", at: s.at }
    case "CloudOnly":
      return { _tag: "CloudOnly" }
    case "Incomplete":
      return {
        _tag: "Incomplete",
        missing: lists(s.missing, seqs(chunks, "lost")),
        corrupt: lists(s.corrupt, seqs(chunks, "corrupt")),
        conflict: lists(s.conflict, seqs(chunks, "conflict")),
        localCopy: s.localCopy
      }
  }
}

export const mapTrip = (i: TripSyncInfo, gaps: ReadonlyArray<Gap>, now: number): TripVm => {
  const chunks: ChunkVm[] = i.chunks.map((c) => ({
    seq: c.seq,
    state: mapChunkState(c.state),
    rows: c.rows,
    bytes: 0,
    attempts: c.attempts,
    ...(c.lastError ? { lastError: c.lastError } : {}),
    ...(c.nextRetryAt ? { nextRetryAt: c.nextRetryAt } : {})
  }))
  const sync = mapTripSync(i.sync, chunks, now)
  return {
    tripId: i.tripId,
    startedAt: i.startedAt,
    endedAt: i.endedAt ?? null,
    points: i.points ?? chunks.reduce((n, c) => n + c.rows, 0),
    distanceKm: i.distanceKm ?? null,
    sync,
    chunks,
    gaps: gaps.map((g) => ({ from: g.from, to: g.to, reason: g.reason })),
    localCopy: sync._tag !== "CloudOnly" && !(sync._tag === "Incomplete" && !sync.localCopy)
  }
}

export const mapSyncTrips = (s: SyncState, gapsByTrip: ReadonlyMap<string, ReadonlyArray<Gap>>, now: number): TripVm[] =>
  s.trips.map((t) => mapTrip(t, gapsByTrip.get(t.tripId) ?? [], now))

export const mapAutoState = (s: AutoState): AutoVm => {
  switch (s._tag) {
    case "Off":
      return { _tag: "Off" }
    case "NeedsTap":
      return { _tag: "NeedsTap", reason: s.reason }
    case "Reconnecting":
      return { _tag: "Reconnecting", attempt: s.attempt, since: s.since }
    case "AdapterNotFound":
      return { _tag: "AdapterNotFound", since: s.since, attempts: s.attempts, nextRetryAt: s.nextRetryAt }
    case "Connecting":
      return { _tag: "Connecting", step: s.step, total: s.total }
    case "Unavailable":
      return { _tag: "Unavailable", code: s.error._tag }
    case "EcuNotResponding":
      return { _tag: "EcuNotResponding", since: s.since, adapterName: s.adapterName }
    case "WaitingForEngine":
      return { _tag: "WaitingForEngine", adapterName: s.adapterName }
    case "Recording":
      return { _tag: "Recording", tripId: s.tripId, startedAt: s.startedAt, adapterName: s.adapterName, linkLostSince: s.linkLost?.since ?? null }
    case "AutoStopped":
      return { _tag: "AutoStopped", tripId: s.tripId, startedAt: s.startedAt, endedAt: s.endedAt }
  }
}
