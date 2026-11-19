import { Schema } from "effect"

export const DtcKind = Schema.Literals(["stored", "pending", "permanent"])
export type DtcKind = typeof DtcKind.Type

export const DtcCode = Schema.Struct({
  code: Schema.String.check(Schema.isPattern(/^[PCBU][0-9A-F]{4}$/)),
  kind: DtcKind
})
export type DtcCode = typeof DtcCode.Type

export const DtcReport = Schema.Struct({
  readAt: Schema.Number,
  milOn: Schema.Boolean,
  codes: Schema.Array(DtcCode),
  tripId: Schema.NullOr(Schema.String),
  vin: Schema.NullOr(Schema.String)
})
export type DtcReport = typeof DtcReport.Type

export const Severity = Schema.Literals(["info", "watch", "soon", "urgent"])
export type Severity = typeof Severity.Type

export const DtcExplanation = Schema.Struct({
  code: Schema.String,
  kind: DtcKind,
  title: Schema.String,
  meaning: Schema.String,
  severity: Severity,
  canDrive: Schema.String,
  commonCauses: Schema.Array(Schema.String),
  whatToDo: Schema.String,
  firstSeenAt: Schema.Number,
  lastSeenAt: Schema.Number,
  source: Schema.Literals(["catalog", "generic"])
})
export type DtcExplanation = typeof DtcExplanation.Type

export const TripInsight = Schema.Struct({
  tripId: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.Number,
  complete: Schema.Boolean,
  points: Schema.Int,
  durationS: Schema.Number,
  movingS: Schema.Number,
  idleS: Schema.Number,
  distanceKm: Schema.NullOr(Schema.Number),
  avgSpeedKmh: Schema.NullOr(Schema.Number),
  avgMovingSpeedKmh: Schema.NullOr(Schema.Number),
  maxSpeedKmh: Schema.NullOr(Schema.Number),
  fuelL: Schema.NullOr(Schema.Number),
  fuelPer100Km: Schema.NullOr(Schema.Number),
  fuelIsEstimate: Schema.Boolean,
  idleFuelL: Schema.NullOr(Schema.Number),
  maxRpm: Schema.NullOr(Schema.Number),
  avgRpm: Schema.NullOr(Schema.Number),
  maxCoolantC: Schema.NullOr(Schema.Number),
  warmupS: Schema.NullOr(Schema.Number),
  minVoltageV: Schema.NullOr(Schema.Number),
  restingVoltageV: Schema.NullOr(Schema.Number),
  hardAccelerations: Schema.Int,
  hardBrakings: Schema.Int,
  crankMinV: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  chargingAvgV: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  startCoolantC: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  endFuelLevelPct: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  speedBands: Schema.Array(Schema.Struct({ fromKmh: Schema.Number, toKmh: Schema.Number, seconds: Schema.Number, fuelPer100Km: Schema.NullOr(Schema.Number) })),
  route: Schema.Struct({
    startLat: Schema.NullOr(Schema.Number),
    startLon: Schema.NullOr(Schema.Number),
    endLat: Schema.NullOr(Schema.Number),
    endLon: Schema.NullOr(Schema.Number)
  }),
  comparedToUsual: Schema.Struct({
    fuelPer100KmDeltaPct: Schema.NullOr(Schema.Number),
    avgSpeedDeltaPct: Schema.NullOr(Schema.Number)
  })
})
export type TripInsight = typeof TripInsight.Type

export const SeriesColumn = Schema.Literals([
  "speed_kmh",
  "rpm",
  "coolant_c",
  "intake_c",
  "load_pct",
  "throttle_pct",
  "fuel_rate_lph",
  "fuel_level_pct",
  "voltage_v",
  "lat",
  "lon"
])
export type SeriesColumn = typeof SeriesColumn.Type

export const TripSeries = Schema.Struct({
  tripId: Schema.String,
  ts: Schema.Array(Schema.Number),
  columns: Schema.Record(Schema.String, Schema.Array(Schema.NullOr(Schema.Number))),
  gaps: Schema.Array(Schema.Struct({ from: Schema.Number, to: Schema.Number }))
})
export type TripSeries = typeof TripSeries.Type

export const AlertKind = Schema.Literals([
  "check_engine",
  "battery_weak",
  "charging_problem",
  "overheating",
  "slow_warmup",
  "fuel_consumption_up",
  "low_fuel"
])
export type AlertKind = typeof AlertKind.Type

export const Alert = Schema.Struct({
  id: Schema.String,
  kind: AlertKind,
  severity: Severity,
  title: Schema.String,
  details: Schema.String,
  whatToDo: Schema.String,
  createdAt: Schema.Number,
  resolvedAt: Schema.NullOr(Schema.Number),
  tripId: Schema.NullOr(Schema.String),
  evidence: Schema.Record(Schema.String, Schema.Number)
})
export type Alert = typeof Alert.Type

export const PeriodStats = Schema.Struct({
  period: Schema.String,
  trips: Schema.Int,
  distanceKm: Schema.Number,
  durationS: Schema.Number,
  fuelL: Schema.NullOr(Schema.Number),
  fuelPer100Km: Schema.NullOr(Schema.Number),
  avgSpeedKmh: Schema.NullOr(Schema.Number),
  idleShare: Schema.NullOr(Schema.Number)
})
export type PeriodStats = typeof PeriodStats.Type

export const CarOverview = Schema.Struct({
  generatedAt: Schema.Number,
  vin: Schema.NullOr(Schema.String),
  lastTripAt: Schema.NullOr(Schema.Number),
  totals: PeriodStats,
  byMonth: Schema.Array(PeriodStats),
  byWeek: Schema.Array(PeriodStats),
  battery: Schema.Struct({
    status: Schema.Literals(["good", "watch", "weak", "unknown"]),
    lastRestingV: Schema.NullOr(Schema.Number),
    lastCrankMinV: Schema.NullOr(Schema.Number),
    trend: Schema.Array(Schema.Struct({ at: Schema.Number, restingV: Schema.NullOr(Schema.Number), crankMinV: Schema.NullOr(Schema.Number) }))
  }),
  engine: Schema.Struct({
    milOn: Schema.Boolean,
    activeCodes: Schema.Array(DtcExplanation),
    lastScanAt: Schema.NullOr(Schema.Number),
    maxCoolantC30d: Schema.NullOr(Schema.Number)
  }),
  alerts: Schema.Array(Alert)
})
export type CarOverview = typeof CarOverview.Type

export const InsightsApi = {
  putDtc: "PUT /car/api/dtc  body DtcReport → { ok: true, explanations: DtcExplanation[] }",
  overview: "GET /car/api/overview → CarOverview",
  tripInsight: "GET /car/api/trips/:tripId/insight → TripInsight",
  tripSeries: "GET /car/api/trips/:tripId/series?points=600&columns=speed_kmh,rpm → TripSeries (downsampled, gaps kept)",
  alerts: "GET /car/api/alerts → { alerts: Alert[] }"
} as const

export const PutDtcResponse = Schema.Struct({ ok: Schema.Literal(true), explanations: Schema.Array(DtcExplanation) })
export const AlertList = Schema.Struct({ alerts: Schema.Array(Alert) })
