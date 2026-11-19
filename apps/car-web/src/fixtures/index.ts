import type { ChunkVm, ChunkState, ConnectionVm, DiagEvent, Reading, TripVm } from "../model/types.ts"

const min = 60_000
export const T0 = Date.UTC(2026, 10, 19, 10, 0, 0)

export const chunks = (states: ChunkState[]): ChunkVm[] =>
  states.map((state, seq) => ({
    seq,
    state,
    rows: 100,
    bytes: 9_800,
    attempts: state === "confirmed" ? 1 : state === "waiting" ? 3 : state === "failed" ? 4 : 1,
    ...(state === "waiting" ? { nextRetryAt: T0 + 40_000, lastError: "network" } : {}),
    ...(state === "failed" ? { lastError: "HTTP 503" } : {})
  }))

const rep = (s: ChunkState, n: number): ChunkState[] => Array.from({ length: n }, () => s)

export const fixtureTrips = (now: number = Date.now()): TripVm[] => [
  {
    tripId: "20261119T100000Z-ab12cd34",
    startedAt: now - 3 * 3600_000,
    endedAt: now - 3 * 3600_000 + 41 * min,
    points: 1380,
    distanceKm: 24.6,
    sync: { _tag: "Waiting", sent: 12, total: 14, nextRetryAt: now + 40_000, lastError: "network", detail: "TypeError: Failed to fetch" },
    chunks: chunks([...rep("confirmed", 10), "sent", "sent", "waiting", "waiting"]),
    gaps: [
      { from: now - 3 * 3600_000 + 10 * min, to: now - 3 * 3600_000 + 12 * min, reason: "adapter_disconnected" },
      { from: now - 3 * 3600_000 + 30 * min, to: now - 3 * 3600_000 + 31 * min, reason: "app_backgrounded" }
    ],
    localCopy: true
  },
  {
    tripId: "20261118T081500Z-ee55aa01",
    startedAt: now - 27 * 3600_000,
    endedAt: now - 27 * 3600_000 + 22 * min,
    points: 740,
    distanceKm: null,
    sync: { _tag: "Confirmed", at: now - 26 * 3600_000 },
    chunks: chunks(rep("confirmed", 8)),
    gaps: [],
    localCopy: true
  },
  {
    tripId: "20261117T170000Z-0f0f0f0f",
    startedAt: now - 50 * 3600_000,
    endedAt: now - 50 * 3600_000 + 15 * min,
    points: 500,
    distanceKm: 9.1,
    sync: { _tag: "Incomplete", missing: [3], corrupt: [5], conflict: [], localCopy: true },
    chunks: chunks(["confirmed", "confirmed", "confirmed", "waiting", "confirmed", "corrupt"]),
    gaps: [],
    localCopy: true
  }
]

export const fixtureReading: Reading = { speedKmh: 62, rpm: 2140, coolantC: 88, fuelRateLph: null, voltage: 13.9 }

export const readyConn: ConnectionVm = { _tag: "Ready", adapterName: "OBDII", sensors: 4, supportedPids: ["0C", "0D", "05", "42"] }

export const fixtureDiag = (now: number = Date.now()): DiagEvent[] => [
  { at: now - 5000, kind: "elm", text: "> ATZ\n< ELM327 v1.5" },
  { at: now - 4000, kind: "elm", text: "> 0100\n< 41 00 BE 3E B8 11" },
  { at: now - 2000, kind: "sync", text: "chunk 3 -> network error" }
]
