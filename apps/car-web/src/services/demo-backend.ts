import { ref } from "vue"
import { buildOverviewFixture, buildTripFixture, type InsightScenario } from "../fixtures/insights.ts"
import { fixtureDiag, fixtureReading, fixtureTrips, readyConn } from "../fixtures/index.ts"
import type {
  AutoVm,
  Capabilities,
  DtcScanOutcome,
  ConnectionVm,
  DiagEvent,
  FuelRateSource,
  PairedDevice,
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
import type { CarBackend, InterruptedTrip, PairingState } from "./backend.ts"

export type DemoOptions = {
  insights?: InsightScenario
  auto?: AutoVm
  insightsDemo?: boolean
  scanDelayMs?: number
  platform?: Platform
  caps?: Capabilities
  conn?: ConnectionVm
  rec?: RecorderVm
  sync?: SyncGlobalVm
  trips?: TripVm[]
  storage?: StorageHealthVm | null
  interrupted?: InterruptedTrip | null
  pairing?: PairingState
  devices?: PairedDevice[]
  diag?: DiagEvent[]
  supported?: SensorKey[] | null
  online?: boolean
  fuelSource?: FuelRateSource
  clockOffsetMs?: number
  static?: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const createDemoBackend = (o: DemoOptions = {}): CarBackend => {
  const caps: Capabilities = o.caps ?? { ble: true, serial: true, secureContext: true, inTelegram: false, reasons: [] }
  const conn = ref<ConnectionVm>(o.conn ?? { _tag: "Idle" })
  const rec = ref<RecorderVm>(o.rec ?? { _tag: "Idle" })
  const sync = ref<SyncGlobalVm>(o.sync ?? { _tag: "Idle" })
  const trips = ref<TripVm[]>(o.trips ?? fixtureTrips())
  const reading = ref<Reading>({ ...fixtureReading })
  const supported = ref<SensorKey[] | null>(o.supported ?? null)
  const storage = ref<StorageHealthVm | null>(o.storage === undefined ? { usedBytes: 12_400_000, quotaBytes: 900_000_000, persisted: false } : o.storage)
  const diag = ref<DiagEvent[]>(o.diag ?? fixtureDiag())
  const devices = ref<PairedDevice[]>(o.devices ?? [])
  const interrupted = ref<InterruptedTrip | null>(o.interrupted ?? null)
  const pairing = ref<PairingState>(o.pairing ?? "paired")
  const online = ref(o.online ?? true)
  const clockOffsetMs = ref(o.clockOffsetMs ?? 0)
  const wakeLock = ref(false)
  const fuelSource = ref<FuelRateSource>(o.fuelSource ?? "none")
  const pollingMs = ref(500)
  const wait = (ms: number) => (o.static ? Promise.resolve() : sleep(ms))
  const auto = ref<AutoVm>(o.auto ?? { _tag: "Off" })
  const insightsDemo = ref(o.insightsDemo ?? true)
  const scenario: InsightScenario = o.insights ?? "issues"
  let scannedAt: number | null = null
  let cancelled = false
  let timer: ReturnType<typeof setInterval> | undefined

  const log = (kind: DiagEvent["kind"], text: string) => {
    diag.value = [...diag.value, { at: Date.now(), kind, text }].slice(-500)
  }

  const tick = () => {
    const r = rec.value
    if (r._tag !== "Recording") return
    rec.value = { ...r, points: r.points + 1, distanceKm: r.distanceKm + 0.015, lastSampleAt: Date.now(), chunks: Math.floor((r.points + 1) / 100) }
    reading.value = {
      speedKmh: Math.round(40 + Math.random() * 40),
      rpm: Math.round(1800 + Math.random() * 900),
      coolantC: 88,
      fuelRateLph: supported.value?.includes("fuelRateLph") ? +(4 + Math.random()).toFixed(1) : null,
      voltageV: 13.9
    }
  }

  const shapeOf = (tripId: string) => {
    const t = trips.value.find((x) => x.tripId === tripId)
    const startedAt = t?.startedAt ?? Date.now() - 3_600_000
    const endedAt = t?.endedAt ?? startedAt + 20 * 60_000
    return { tripId, startedAt, durationS: Math.max(60, Math.round((endedAt - startedAt) / 1000)) }
  }

  return {
    platform: o.platform ?? "android",
    caps,
    demo: true,
    conn,
    rec,
    sync,
    trips,
    reading,
    supported,
    storage,
    diag,
    devices,
    interrupted,
    pairing,
    online,
    clockOffsetMs,
    fuelSource,
    wakeLock,
    pollingMs,
    insightsDemo,
    auto,

    async overview(lang) {
      await wait(250)
      const base = buildOverviewFixture(scenario, lang, Date.now())
      return scannedAt === null ? base : { ...base, engine: { ...base.engine, lastScanAt: scannedAt } }
    },
    async tripInsight(tripId) {
      await wait(250)
      return buildTripFixture(shapeOf(tripId)).insight
    },
    async tripSeries(tripId) {
      await wait(350)
      return buildTripFixture(shapeOf(tripId)).series
    },
    async alerts(lang) {
      return buildOverviewFixture(scenario, lang, Date.now()).alerts
    },
    async scanDtc(): Promise<DtcScanOutcome> {
      await wait(o.scanDelayMs ?? 1800)
      scannedAt = Date.now()
      return { _tag: "Done", at: scannedAt, codes: scenario === "issues" ? ["P0420", "P0171"] : [], milOn: scenario === "issues" }
    },
    async enableAuto() {
      auto.value = { _tag: "WaitingForEngine", adapterName: "Demo" }
    },
    async connectAdapter() {
      auto.value = { _tag: "WaitingForEngine", adapterName: "Demo" }
    },
    async forgetAdapter() {
      auto.value = { _tag: "NeedsTap", reason: "forgotten" }
    },
    async dismissAutoStopped() {
      auto.value = { _tag: "WaitingForEngine", adapterName: "Demo" }
    },

    async connect(kind: TransportKind, scenario: SimScenario = "normal") {
      cancelled = false
      log("obd", `connect ${kind} ${scenario}`)
      const fail = (code: "BluetoothUnavailable" | "SerialUnavailable" | "EcuNotResponding" | "AdapterNotResponding", step?: string) => {
        conn.value = { _tag: "Failed", error: { code, ...(step ? { step } : {}) } }
      }
      if (kind === "ble" && !caps.ble) return fail("BluetoothUnavailable")
      if (kind === "serial" && !caps.serial) return fail("SerialUnavailable")
      const pause = o.static ? 0 : 600
      conn.value = { _tag: "RequestingDevice" }
      await sleep(pause)
      if (cancelled) return
      conn.value = { _tag: "Connecting" }
      await sleep(pause)
      for (const [i, label] of ["ATZ", "ATE0", "ATSP0"].entries()) {
        if (cancelled) return
        conn.value = { _tag: "InitializingAdapter", step: i + 1, total: 3, label }
        log("elm", `> ${label}`)
        await sleep(pause / 2)
        if (scenario === "clone_garbage" && i === 0) {
          log("elm", "< ÿþ?? garbage")
          return fail("AdapterNotResponding", "ATZ")
        }
      }
      conn.value = { _tag: "WaitingForEcu" }
      await sleep(pause)
      if (scenario === "ignition_off") {
        log("elm", "< UNABLE TO CONNECT")
        return fail("EcuNotResponding")
      }
      const sensors: SensorKey[] = scenario === "no_fuel_pid" ? ["speedKmh", "rpm", "coolantC", "voltageV"] : ["speedKmh", "rpm", "coolantC", "voltageV", "fuelRateLph"]
      supported.value = sensors
      conn.value = { ...readyConn, sensors: sensors.length, adapterName: kind === "simulator" ? "Demo" : "OBDII" } as ConnectionVm
    },
    cancelConnect() {
      cancelled = true
      conn.value = { _tag: "Idle" }
    },
    async startRecording() {
      const startedAt = Date.now()
      rec.value = { _tag: "Recording", tripId: `demo-${startedAt}`, startedAt, points: 0, chunks: 0, distanceKm: 0, lastSampleAt: startedAt, gapOpen: false }
      wakeLock.value = true
      if (!o.static) timer = setInterval(tick, 1000)
    },
    async stopRecording() {
      rec.value = { _tag: "Finishing" }
      if (timer) clearInterval(timer)
      await sleep(o.static ? 0 : 400)
      rec.value = { _tag: "Idle" }
      wakeLock.value = false
    },
    async resumeInterrupted() {
      const i = interrupted.value
      interrupted.value = null
      if (!i) return
      rec.value = { _tag: "Recording", tripId: i.tripId, startedAt: i.interruptedAt - 60_000, points: i.points, chunks: Math.floor(i.points / 100), distanceKm: 0, lastSampleAt: Date.now(), gapOpen: true }
    },
    async finishInterrupted() {
      interrupted.value = null
    },
    async retryNow(tripId) {
      log("sync", `retry ${tripId}`)
      trips.value = trips.value.map((t) =>
        t.tripId === tripId
          ? { ...t, sync: { _tag: "Uploading", sent: t.chunks.length, total: t.chunks.length, confirmed: t.chunks.length - 1 }, chunks: t.chunks.map((c) => ({ ...c, state: "confirmed" as const })) }
          : t
      )
      await sleep(o.static ? 0 : 800)
      trips.value = trips.value.map((t) => (t.tripId === tripId ? { ...t, sync: { _tag: "Confirmed", at: Date.now() } } : t))
    },
    async exportTrip(tripId) {
      log("app", `export ${tripId}`)
    },
    async deleteLocal(tripId) {
      trips.value = trips.value.map((t) => (t.tripId === tripId ? { ...t, localCopy: false, sync: { _tag: "CloudOnly" } } : t))
    },
    async requestPersistence() {
      if (storage.value) storage.value = { ...storage.value, persisted: true }
      return true
    },
    setPollingMs(ms) {
      pollingMs.value = ms
    },
    async refreshDevices() {},
    async revokeDevice(id) {
      devices.value = devices.value.filter((d) => d.id !== id)
    },
    async adoptCredential() {},
    async retryPairing() {
      pairing.value = "unpaired"
    },
    dispose() {
      if (timer) clearInterval(timer)
    }
  }
}
