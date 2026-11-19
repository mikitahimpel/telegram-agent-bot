/**
 * One recorded data point. Every field except `ts` may be missing:
 * the car may not support the PID, the adapter may have timed out, GPS may be off.
 * Missing ≠ zero — keep it `undefined` and write an empty CSV cell.
 */
export interface Sample {
  /** Device clock, epoch milliseconds. */
  readonly ts: number
  readonly lat?: number | undefined
  readonly lon?: number | undefined
  readonly gpsAccuracyM?: number | undefined
  readonly gpsSpeedKmh?: number | undefined
  /** PID 0D */
  readonly speedKmh?: number | undefined
  /** PID 0C */
  readonly rpm?: number | undefined
  /** PID 05 */
  readonly coolantC?: number | undefined
  /** PID 0F */
  readonly intakeC?: number | undefined
  /** PID 04 */
  readonly loadPct?: number | undefined
  /** PID 11 */
  readonly throttlePct?: number | undefined
  /** PID 10, grams/second */
  readonly mafGps?: number | undefined
  /** PID 0B */
  readonly mapKpa?: number | undefined
  /** PID 5E, or estimated from MAF (see `fuelRateSource`) */
  readonly fuelRateLph?: number | undefined
  /** PID 2F */
  readonly fuelLevelPct?: number | undefined
  /** PID 42 or `AT RV` */
  readonly voltageV?: number | undefined
}

/** CSV column order. Append-only: never reorder or rename, bump `FORMAT_VERSION` instead. */
export const COLUMNS = [
  ["ts", "ts"],
  ["lat", "lat"],
  ["lon", "lon"],
  ["gps_accuracy_m", "gpsAccuracyM"],
  ["gps_speed_kmh", "gpsSpeedKmh"],
  ["speed_kmh", "speedKmh"],
  ["rpm", "rpm"],
  ["coolant_c", "coolantC"],
  ["intake_c", "intakeC"],
  ["load_pct", "loadPct"],
  ["throttle_pct", "throttlePct"],
  ["maf_gps", "mafGps"],
  ["map_kpa", "mapKpa"],
  ["fuel_rate_lph", "fuelRateLph"],
  ["fuel_level_pct", "fuelLevelPct"],
  ["voltage_v", "voltageV"]
] as const satisfies ReadonlyArray<readonly [string, keyof Sample]>

export type ColumnName = (typeof COLUMNS)[number][0]

export const FORMAT_VERSION = 1
