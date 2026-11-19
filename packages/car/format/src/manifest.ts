import { Schema } from "effect"

/**
 * Trip id, sortable by start time: `20261119T102030Z-ab12cd34`.
 * Generated on the device; must match TRIP_ID_PATTERN.
 */
export const TRIP_ID_PATTERN = /^\d{8}T\d{6}Z-[a-z0-9]{8}$/
export const TripId = Schema.String.check(Schema.isPattern(TRIP_ID_PATTERN)).pipe(Schema.brand("TripId"))
export type TripId = typeof TripId.Type

export const makeTripId = (startedAt: Date, random: string): TripId => {
  const iso = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  return TripId.make(`${iso}-${random.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 8)}`)
}

/** One chunk = one CSV object of consecutive samples. `seq` starts at 0, no holes on the device. */
export const ChunkInfo = Schema.Struct({
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rows: Schema.Int,
  bytes: Schema.Int,
  /** Lowercase hex SHA-256 of the exact CSV bytes. */
  sha256: Schema.String,
  firstTs: Schema.Number,
  lastTs: Schema.Number
})
export type ChunkInfo = typeof ChunkInfo.Type

/** Interval with no data, so the analysis does not interpolate across it. */
export const Gap = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  reason: Schema.Literals(["adapter_disconnected", "ecu_no_response", "app_backgrounded", "app_restarted", "unknown"])
})
export type Gap = typeof Gap.Type

export const TripManifest = Schema.Struct({
  formatVersion: Schema.Literal(1),
  tripId: TripId,
  /** "recording" while the trip is open; "finished" once the user stopped it (or crash recovery closed it). */
  status: Schema.Literals(["recording", "finished"]),
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  /** Total chunks the device produced. Only meaningful when status = finished. */
  chunkCount: Schema.Int,
  chunks: Schema.Array(ChunkInfo),
  gaps: Schema.Array(Gap),
  /** OBD PIDs the ECU reported as supported, e.g. ["0C","0D"]. */
  supportedPids: Schema.Array(Schema.String),
  device: Schema.Struct({
    appVersion: Schema.String,
    userAgent: Schema.String,
    adapterName: Schema.optional(Schema.String),
    transport: Schema.Literals(["ble", "serial", "simulator"]),
    obdProtocol: Schema.optional(Schema.String),
    vin: Schema.optional(Schema.String)
  }),
  /** How fuel rate was obtained: direct PID 5E, MAF estimate, or not available. */
  fuelRateSource: Schema.Literals(["pid_5e", "maf_estimate", "none"]),
  /** Optional user note, e.g. "дача". */
  note: Schema.optional(Schema.String)
})
export type TripManifest = typeof TripManifest.Type
