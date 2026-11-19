import type { Ref } from "vue"
import type {
  AppMode,
  Capabilities,
  ConnectionVm,
  DiagEvent,
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

export interface InterruptedTrip {
  tripId: string
  interruptedAt: number
  points: number
}

/**
 * Everything the UI needs from the car packages. The Vue refs are fed from Effect SubscriptionRefs
 * (see use-effect-state.ts) by the real adapter, or by simulation in the demo backend.
 */
export interface CarBackend {
  readonly mode: AppMode
  readonly platform: Platform
  readonly caps: Capabilities
  readonly demo: boolean

  readonly conn: Ref<ConnectionVm>
  readonly rec: Ref<RecorderVm>
  readonly sync: Ref<SyncGlobalVm>
  readonly trips: Ref<TripVm[]>
  readonly reading: Ref<Reading>
  /** null = not known yet; otherwise sensors the car reported as supported. */
  readonly supported: Ref<SensorKey[] | null>
  readonly storage: Ref<StorageHealthVm | null>
  readonly diag: Ref<DiagEvent[]>
  readonly devices: Ref<PairedDevice[]>
  readonly interrupted: Ref<InterruptedTrip | null>
  readonly pairing: Ref<PairingState>
  readonly online: Ref<boolean>
  readonly clockOffsetMs: Ref<number>
  readonly wakeLock: Ref<boolean>
  readonly pollingMs: Ref<number>

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
  /** Mini App: POST /pair/start and return the link for openLink. null on failure. */
  pairStart(): Promise<string | null>
  refreshDevices(): Promise<void>
  revokeDevice(id: string): Promise<void>
  retryPairing(): Promise<void>
  dispose(): void
}
