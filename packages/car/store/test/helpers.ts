import { sha256Hex } from "@bot/car-format/checksum"
import { encodeCsv } from "@bot/car-format/csv"
import { makeTripId, type TripManifest } from "@bot/car-format/manifest"
import type { Sample } from "@bot/car-format/sample"
import { makeEngine, type CarEngine } from "../src/engine.ts"
import { makeNodeSql } from "../src/testing.ts"

export const T0 = Date.UTC(2026, 10, 1, 8, 0, 0)
export const DAY = 86_400_000

export const gen = (startTs: number, seconds: number, f: (t: number) => Partial<Sample>): Array<Sample> =>
  Array.from({ length: seconds }, (_, t) => ({ ts: startTs + t * 1000, ...f(t) }))

export type BuiltTrip = {
  readonly tripId: string
  readonly manifest: TripManifest
  readonly chunks: ReadonlyArray<{ readonly seq: number; readonly csv: string; readonly sha: string }>
}

export const buildTrip = async (
  startTs: number,
  samples: ReadonlyArray<Sample>,
  opts: {
    rows?: number
    gaps?: TripManifest["gaps"]
    rand?: string
    fuel?: TripManifest["fuelRateSource"]
    status?: "finished" | "recording"
  } = {}
): Promise<BuiltTrip> => {
  const rows = opts.rows ?? 120
  const parts: Array<ReadonlyArray<Sample>> = []
  for (let i = 0; i < samples.length; i += rows) parts.push(samples.slice(i, i + rows))
  const tripId = makeTripId(new Date(startTs), opts.rand ?? "abcd1234")
  const chunks = await Promise.all(
    parts.map(async (p, seq) => {
      const csv = encodeCsv(p)
      return { seq, csv, sha: await sha256Hex(csv) }
    })
  )
  const manifest: TripManifest = {
    formatVersion: 1,
    tripId,
    status: opts.status ?? "finished",
    startedAt: startTs,
    endedAt: (samples[samples.length - 1] as Sample).ts,
    chunkCount: chunks.length,
    chunks: chunks.map((c, seq) => ({
      seq,
      rows: (parts[seq] as ReadonlyArray<Sample>).length,
      bytes: new TextEncoder().encode(c.csv).length,
      sha256: c.sha,
      firstTs: (parts[seq] as ReadonlyArray<Sample>)[0]?.ts ?? 0,
      lastTs: (parts[seq] as ReadonlyArray<Sample>).at(-1)?.ts ?? 0
    })),
    gaps: opts.gaps ?? [],
    supportedPids: [],
    device: { appVersion: "t", userAgent: "t", transport: "simulator" },
    fuelRateSource: opts.fuel ?? "pid_5e"
  }
  return { tripId, manifest, chunks }
}

export const ingestAll = (engine: CarEngine, trip: BuiltTrip) => {
  for (const c of trip.chunks) engine.ingestChunk(trip.tripId, c.seq, c.sha, c.csv)
  return engine.ingestManifest(trip.manifest)
}

export const newEngine = (now: () => number = () => T0 + 10 * DAY) => {
  const sql = makeNodeSql()
  return { sql, engine: makeEngine(sql, now) }
}

export const cruise =
  (kmh: number, extra: Partial<Sample> = {}) =>
  (): Partial<Sample> => ({
    speedKmh: kmh,
    rpm: 2000,
    coolantC: 90,
    voltageV: 14.1,
    fuelRateLph: 6,
    ...extra
  })
