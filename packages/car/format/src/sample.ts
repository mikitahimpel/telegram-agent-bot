export type Sample = {
  readonly ts: number
  readonly lat?: number | undefined
  readonly lon?: number | undefined
  readonly gpsAccuracyM?: number | undefined
  readonly gpsSpeedKmh?: number | undefined
  readonly speedKmh?: number | undefined
  readonly rpm?: number | undefined
  readonly coolantC?: number | undefined
  readonly intakeC?: number | undefined
  readonly loadPct?: number | undefined
  readonly throttlePct?: number | undefined
  readonly mafGps?: number | undefined
  readonly mapKpa?: number | undefined
  readonly fuelRateLph?: number | undefined
  readonly fuelLevelPct?: number | undefined
  readonly voltageV?: number | undefined
}

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
