import { Schema } from "effect"

export const TRIP_ID_PATTERN = /^\d{8}T\d{6}Z-[a-z0-9]{8}$/
export const TripId = Schema.String.check(Schema.isPattern(TRIP_ID_PATTERN)).pipe(Schema.brand("TripId"))
export type TripId = typeof TripId.Type

export const makeTripId = (startedAt: Date, random: string): TripId => {
  const iso = startedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")
  return TripId.make(
    `${iso}-${random
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .padEnd(8, "0")
      .slice(0, 8)}`
  )
}

export const ChunkInfo = Schema.Struct({
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rows: Schema.Int,
  bytes: Schema.Int,
  sha256: Schema.String,
  firstTs: Schema.Number,
  lastTs: Schema.Number
})
export type ChunkInfo = typeof ChunkInfo.Type

export const Gap = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  reason: Schema.Literals(["adapter_disconnected", "ecu_no_response", "app_backgrounded", "app_restarted", "unknown"])
})
export type Gap = typeof Gap.Type

export const BatteryEvents = Schema.Struct({
  restingV: Schema.optional(Schema.Number),
  restingAt: Schema.optional(Schema.Number),
  crankMinV: Schema.optional(Schema.Number),
  crankAt: Schema.optional(Schema.Number),
  crankDurationMs: Schema.optional(Schema.Number),
  crankSamples: Schema.optional(Schema.Int),
  chargingV: Schema.optional(Schema.Number),
  chargingMinV: Schema.optional(Schema.Number),
  chargingMaxV: Schema.optional(Schema.Number),
  chargingSamples: Schema.optional(Schema.Int),
  chargingAt: Schema.optional(Schema.Number)
})
export type BatteryEvents = typeof BatteryEvents.Type

export const TripTrigger = Schema.Literals(["auto", "manual"])
export type TripTrigger = typeof TripTrigger.Type

export const TripEndReason = Schema.Literals(["manual", "engine_off", "ecu_silent", "adapter_lost", "interrupted"])
export type TripEndReason = typeof TripEndReason.Type

export const TripManifest = Schema.Struct({
  formatVersion: Schema.Literal(1),
  tripId: TripId,
  status: Schema.Literals(["recording", "finished"]),
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  chunkCount: Schema.Int,
  chunks: Schema.Array(ChunkInfo),
  gaps: Schema.Array(Gap),
  supportedPids: Schema.Array(Schema.String),
  device: Schema.Struct({
    appVersion: Schema.String,
    userAgent: Schema.String,
    adapterName: Schema.optional(Schema.String),
    transport: Schema.Literals(["ble", "serial", "simulator"]),
    obdProtocol: Schema.optional(Schema.String),
    vin: Schema.optional(Schema.String)
  }),
  fuelRateSource: Schema.Literals(["pid_5e", "maf_estimate", "none"]),
  note: Schema.optional(Schema.String),
  battery: Schema.optional(BatteryEvents),
  trigger: Schema.optional(TripTrigger),
  endReason: Schema.optional(TripEndReason)
})
export type TripManifest = typeof TripManifest.Type
