import type { Ref } from "vue"
import type { Alert, CarOverview, TripInsight, TripSeries } from "@bot/car-format/insights"
import type { Lang } from "../i18n/format.ts"
import type {
  AutoVm,
  Capabilities,
  DtcScanOutcome,
  ConnectionVm,
  DiagEvent,
  FuelRateSource,
  PairedDevice,
  PairError,
  Platform,
  Reading,
  RecorderVm,
  SensorKey,
  SimScenario,
  StorageHealthVm,
  SyncGlobalVm,
  TransportKind,
  TripVm
} from "../model/types.ts"

export type PairingState = "paired" | "unpaired" | "progress" | PairError

export type InterruptedTrip = {
  tripId: string
  interruptedAt: number
  points: number
}


export type CarBackend = {
  readonly platform: Platform
  readonly caps: Capabilities
  readonly demo: boolean

  readonly conn: Ref<ConnectionVm>
  readonly rec: Ref<RecorderVm>
  readonly sync: Ref<SyncGlobalVm>
  readonly trips: Ref<TripVm[]>
  readonly reading: Ref<Reading>
  readonly supported: Ref<SensorKey[] | null>
  readonly storage: Ref<StorageHealthVm | null>
  readonly diag: Ref<DiagEvent[]>
  readonly devices: Ref<PairedDevice[]>
  readonly interrupted: Ref<InterruptedTrip | null>
  readonly pairing: Ref<PairingState>
  readonly online: Ref<boolean>
  readonly clockOffsetMs: Ref<number>
  readonly fuelSource: Ref<FuelRateSource>
  readonly wakeLock: Ref<boolean>
  readonly pollingMs: Ref<number>
  readonly insightsDemo: Ref<boolean>
  readonly auto: Ref<AutoVm>

  overview(lang: Lang): Promise<CarOverview>
  tripInsight(tripId: string, lang: Lang): Promise<TripInsight>
  tripSeries(tripId: string): Promise<TripSeries>
  alerts(lang: Lang): Promise<ReadonlyArray<Alert>>
  scanDtc(): Promise<DtcScanOutcome>
  enableAuto(): Promise<void>
  connectAdapter(): Promise<void>
  forgetAdapter(): Promise<void>
  dismissAutoStopped(): Promise<void>

  connect(kind: TransportKind, scenario?: SimScenario): Promise<void>
  cancelConnect(): void
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  resumeInterrupted(): Promise<void>
  finishInterrupted(): Promise<void>
  retryNow(tripId: string): Promise<void>
  exportTrip(tripId: string): Promise<void>
  deleteLocal(tripId: string): Promise<void>
  requestPersistence(): Promise<boolean>
  setPollingMs(ms: number): void
  refreshDevices(): Promise<void>
  revokeDevice(id: string): Promise<void>
  retryPairing(): Promise<void>
  adoptCredential(c: { deviceToken: string }): Promise<void>
  dispose(): void
}
