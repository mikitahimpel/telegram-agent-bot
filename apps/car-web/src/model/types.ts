export type ObdErrorCode =
  | "BluetoothUnavailable"
  | "SerialUnavailable"
  | "PermissionDenied"
  | "DeviceNotSelected"
  | "UnsupportedDevice"
  | "AdapterNotResponding"
  | "EcuNotResponding"
  | "CommandTimeout"
  | "CommandRejected"
  | "Disconnected"

export type ConnError = {
  code: ObdErrorCode
  step?: string
  reason?: string
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
  | { _tag: "Ready"; adapterName?: string; sensors: number; supportedPids: string[]; fuelRateSource: FuelRateSource }
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
      distanceKm: number
      lastSampleAt: number
      gapOpen: boolean
      sourceEnded?: boolean
      storageError?: "quota" | "unavailable" | "unknown"
    }
  | { _tag: "Finishing" }
  | { _tag: "Error"; message: string }

export type ApiBlockCode = "plugin_disabled" | "forbidden"

export type SyncGlobalVm =
  | { _tag: "Idle" }
  | { _tag: "Syncing" }
  | { _tag: "Offline" }
  | { _tag: "NeedsReauth"; reason: "device_revoked" | "not_paired" }
  | { _tag: "Blocked"; code: ApiBlockCode }
  | { _tag: "Paused" }

export type SyncErrorCode = "network" | "rate_limited" | "server" | "checksum_mismatch" | "unauthorized" | "unknown"

export type TripSyncVm =
  | { _tag: "Recording" }
  | { _tag: "Queued" }
  | { _tag: "Uploading"; sent: number; total: number; confirmed: number }
  | { _tag: "Waiting"; sent: number; total: number; nextRetryAt: number; lastError: SyncErrorCode; detail?: string }
  | { _tag: "Verifying" }
  | { _tag: "Confirmed"; at: number }
  | { _tag: "Incomplete"; missing: number[]; corrupt: number[]; conflict: number[]; localCopy: boolean }
  | { _tag: "CloudOnly" }

export type ChunkState = "confirmed" | "sent" | "waiting" | "failed" | "conflict" | "corrupt" | "lost"

export type ChunkVm = {
  seq: number
  state: ChunkState
  rows: number
  bytes: number
  attempts: number
  lastError?: string
  nextRetryAt?: number
}

export type GapVm = {
  from: number
  to: number
  reason: "adapter_disconnected" | "ecu_no_response" | "app_backgrounded" | "app_restarted" | "unknown"
}

export type TripVm = {
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

export type StorageHealthVm = {
  usedBytes: number
  quotaBytes: number
  persisted: boolean
}

export type Reading = {
  speedKmh: number | null
  rpm: number | null
  coolantC: number | null
  fuelRateLph: number | null
  voltageV: number | null
}

export type SensorKey = keyof Reading

export type DiagEvent = {
  at: number
  kind: "obd" | "elm" | "sync" | "app" | "error"
  text: string
}

export type Capabilities = {
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
  | "exportFile"
  | "openSettings"
  | "tryDemo"
  | "openTrip"
  | "openTrips"
  | "requestPersistence"
  | "deleteLocal"
  | "openInChrome"
  | "howToPair"
  | "revokeDevice"
  | "install"

export type Tone = "ok" | "info" | "progress" | "warn" | "error"

export type Platform = "android" | "ios" | "desktop" | "other"
export type FuelRateSource = "pid_5e" | "maf_estimate" | "none"

export type PairedDevice = {
  id: string
  name: string
  lastSeenAt: number | null
  current: boolean
}

export type PairError = "invalid" | "network" | "blocked" | "unknown"

export type AutoNeedsTap = "first_use" | "unsupported" | "forgotten" | "gesture_required" | "permission_denied"

export type AutoVm =
  | { _tag: "Off" }
  | { _tag: "NeedsTap"; reason: AutoNeedsTap }
  | { _tag: "Reconnecting"; attempt: number; since: number }
  | { _tag: "AdapterNotFound"; since: number; attempts: number; nextRetryAt: number }
  | { _tag: "Connecting"; step: number; total: number }
  | { _tag: "Unavailable"; code: string }
  | { _tag: "EcuNotResponding"; since: number; adapterName: string }
  | { _tag: "WaitingForEngine"; adapterName: string }
  | { _tag: "Recording"; tripId: string; startedAt: number; adapterName: string; linkLostSince: number | null }
  | { _tag: "AutoStopped"; tripId: string; startedAt: number; endedAt: number }

export type DtcScanOutcome =
  | { _tag: "Done"; at: number; codes: string[]; milOn: boolean }
  | { _tag: "NeedsConnection" }
  | { _tag: "Failed"; reason: string }
