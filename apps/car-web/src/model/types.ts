/** Plain view-model types. The service adapters convert the Effect state models of the car packages into these. */

export type ObdErrorCode =
  | "BluetoothUnavailable"
  | "SerialUnavailable"
  | "PermissionDenied"
  | "DeviceNotSelected"
  | "UnsupportedDevice"
  | "AdapterNotResponding"
  | "EcuNotResponding"
  | "CommandTimeout"
  | "Disconnected"

export interface ConnError {
  code: ObdErrorCode
  /** Init step that failed (AdapterNotResponding). */
  step?: string
  /** Raw technical text for the "Details" block. */
  detail?: string
}

export type TransportKind = "ble" | "serial" | "simulator"
export type SimScenario = "normal" | "ignition_off" | "clone_garbage" | "drops_every_60s" | "slow_ecu" | "no_fuel_pid"

export type ConnectionVm =
  | { _tag: "Idle" }
  | { _tag: "RequestingDevice" }
  | { _tag: "Connecting" }
  | { _tag: "InitializingAdapter"; step: number; total: number; label: string }
  | { _tag: "WaitingForEcu" }
  | { _tag: "Ready"; adapterName?: string; sensors: number; supportedPids: string[] }
  | { _tag: "Lost"; since: number; attempt: number; nextRetryAt: number }
  | { _tag: "Failed"; error: ConnError }

export type RecorderVm =
  | { _tag: "Idle" }
  | {
      _tag: "Recording"
      tripId: string
      startedAt: number
      points: number
      chunks: number
      lastSampleAt: number
      gapOpen: boolean
    }
  | { _tag: "Finishing" }
  | { _tag: "Error"; message: string }

export type ApiBlockCode = "plugin_disabled" | "forbidden"

export type SyncGlobalVm =
  | { _tag: "Idle" }
  | { _tag: "Syncing" }
  | { _tag: "Offline" }
  | { _tag: "NeedsReauth"; reason: "session_expired" | "device_revoked" }
  | { _tag: "Blocked"; code: ApiBlockCode }
  | { _tag: "Paused" }

export type SyncErrorCode =
  | "network"
  | "rate_limited"
  | "server"
  | "checksum_mismatch"
  | "unauthorized"
  | "unknown"

export type TripSyncVm =
  | { _tag: "Recording" }
  | { _tag: "Queued" }
  | { _tag: "Uploading"; sent: number; total: number; confirmed: number }
  | { _tag: "Waiting"; sent: number; total: number; nextRetryAt: number; lastError: SyncErrorCode; detail?: string }
  | { _tag: "Verifying" }
  | { _tag: "Confirmed"; at: number }
  | { _tag: "Incomplete"; missing: number[]; corrupt: number[]; conflict: number[]; localCopy: boolean }
  | { _tag: "CloudOnly" }

export type ChunkState = "confirmed" | "sent" | "waiting" | "failed" | "conflict" | "corrupt"

export interface ChunkVm {
  seq: number
  state: ChunkState
  rows: number
  bytes: number
  attempts: number
  lastError?: string
  nextRetryAt?: number
}

export interface GapVm {
  from: number
  to: number
  reason: "adapter_disconnected" | "ecu_no_response" | "app_backgrounded" | "app_restarted" | "unknown"
}

export interface TripVm {
  tripId: string
  startedAt: number
  endedAt: number | null
  points: number
  distanceKm: number | null
  sync: TripSyncVm
  chunks: ChunkVm[]
  gaps: GapVm[]
  localCopy: boolean
}

export interface StorageHealthVm {
  usedBytes: number
  quotaBytes: number
  persisted: boolean
}

export interface Reading {
  speedKmh: number | null
  rpm: number | null
  coolantC: number | null
  fuelRateLph: number | null
  voltage: number | null
}

export type SensorKey = keyof Reading

export interface DiagEvent {
  at: number
  kind: "obd" | "elm" | "sync" | "app" | "error"
  text: string
}

export interface Capabilities {
  ble: boolean
  serial: boolean
  secureContext: boolean
  inTelegram: boolean
  reasons: string[]
}

export type ActionId =
  | "connect"
  | "retry"
  | "retryNow"
  | "start"
  | "stop"
  | "reopenFromBot"
  | "exportFile"
  | "openSettings"
  | "tryDemo"
  | "openTrip"
  | "openTrips"
  | "requestPersistence"
  | "deleteLocal"
  | "openChrome"
  | "openInChrome"
  | "howToPair"
  | "revokeDevice"
  | "install"

export type Tone = "ok" | "info" | "progress" | "warn" | "error"

export type AppMode = "telegram" | "chrome"
export type Platform = "android" | "ios" | "desktop" | "other"

export interface PairedDevice {
  id: string
  name: string
  lastSeenAt: number | null
  current: boolean
}

export type PairError = "invalid" | "network" | "blocked" | "unknown"
