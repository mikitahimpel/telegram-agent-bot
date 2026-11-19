import type { CarSql } from "./sql.ts"

export const SCHEMA_VERSION = 1

const STATEMENTS: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS car_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS car_trips (
    trip_id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    fuel_rate_source TEXT NOT NULL DEFAULT 'none',
    vin TEXT,
    gaps_json TEXT NOT NULL DEFAULT '[]',
    manifest_json TEXT,
    complete INTEGER NOT NULL DEFAULT 0,
    computed_at INTEGER,
    notified_at INTEGER,
    points INTEGER,
    duration_s REAL,
    moving_s REAL,
    idle_s REAL,
    distance_km REAL,
    avg_speed_kmh REAL,
    avg_moving_speed_kmh REAL,
    max_speed_kmh REAL,
    fuel_l REAL,
    fuel_distance_km REAL,
    fuel_per_100km REAL,
    fuel_is_estimate INTEGER,
    idle_fuel_l REAL,
    max_rpm REAL,
    avg_rpm REAL,
    start_coolant_c REAL,
    max_coolant_c REAL,
    warmup_s REAL,
    min_voltage_v REAL,
    resting_voltage_v REAL,
    crank_min_v REAL,
    charging_avg_v REAL,
    end_fuel_level_pct REAL,
    hard_accelerations INTEGER,
    hard_brakings INTEGER,
    insight_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS car_trips_started ON car_trips (started_at)`,
  `CREATE TABLE IF NOT EXISTS car_chunks (
    trip_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    rows INTEGER NOT NULL,
    first_ts INTEGER NOT NULL,
    last_ts INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (trip_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS car_samples (
    trip_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    n INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    lat REAL,
    lon REAL,
    gps_accuracy_m REAL,
    gps_speed_kmh REAL,
    speed_kmh REAL,
    rpm REAL,
    coolant_c REAL,
    intake_c REAL,
    load_pct REAL,
    throttle_pct REAL,
    maf_gps REAL,
    map_kpa REAL,
    fuel_rate_lph REAL,
    fuel_level_pct REAL,
    voltage_v REAL,
    PRIMARY KEY (trip_id, seq, n)
  )`,
  `CREATE INDEX IF NOT EXISTS car_samples_ts ON car_samples (trip_id, ts)`,
  `CREATE TABLE IF NOT EXISTS car_dtc_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    read_at INTEGER NOT NULL,
    mil_on INTEGER NOT NULL,
    trip_id TEXT,
    vin TEXT,
    codes_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS car_dtc_codes (
    code TEXT NOT NULL,
    kind TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    reads INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    cleared_at INTEGER,
    notified_at INTEGER,
    PRIMARY KEY (code, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS car_alerts (
    id TEXT PRIMARY KEY,
    dedup_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    notified_at INTEGER,
    trip_id TEXT,
    evidence_json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS car_alerts_key ON car_alerts (dedup_key, resolved_at)`,
  `CREATE TABLE IF NOT EXISTS car_battery_events (
    trip_id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    resting_v REAL,
    crank_min_v REAL,
    charging_avg_v REAL,
    charging_min_v REAL,
    charging_max_v REAL
  )`
]

export const migrate = (sql: CarSql): void => {
  for (const s of STATEMENTS) sql.run(s)
  sql.run(`INSERT OR IGNORE INTO car_meta (key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)])
}

export const SCHEMA_DESCRIPTION = `Tables (SQLite, all times are epoch milliseconds UTC, missing values are NULL, never 0):
car_trips(trip_id, started_at, ended_at, status 'recording'|'finished', complete 0|1, chunk_count, fuel_rate_source, vin, points, duration_s, moving_s, idle_s, distance_km, avg_speed_kmh, avg_moving_speed_kmh, max_speed_kmh, fuel_l, fuel_distance_km, fuel_per_100km, fuel_is_estimate, idle_fuel_l, max_rpm, avg_rpm, start_coolant_c, max_coolant_c, warmup_s, min_voltage_v, resting_voltage_v, crank_min_v, charging_avg_v, end_fuel_level_pct, hard_accelerations, hard_brakings) - one row per trip, metrics are filled for complete trips.
car_samples(trip_id, seq, n, ts, lat, lon, gps_accuracy_m, gps_speed_kmh, speed_kmh, rpm, coolant_c, intake_c, load_pct, throttle_pct, maf_gps, map_kpa, fuel_rate_lph, fuel_level_pct, voltage_v) - raw samples; join with car_trips on trip_id; order by ts.
car_battery_events(trip_id, at, resting_v, crank_min_v, charging_avg_v, charging_min_v, charging_max_v) - one row per complete trip.
car_dtc_reads(id, read_at, mil_on, trip_id, vin, codes_json) - every diagnostic scan.
car_dtc_codes(code, kind 'stored'|'pending'|'permanent', first_seen_at, last_seen_at, reads, active 0|1, cleared_at) - trouble code history.
car_alerts(id, dedup_key, kind, severity, created_at, updated_at, resolved_at, trip_id, evidence_json) - alerts, resolved_at NULL means open.`
