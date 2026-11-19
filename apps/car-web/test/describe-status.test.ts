import { describe, expect, it } from "vitest"
import type { Lang } from "../src/i18n/format.ts"
import { describeStatus, type StatusInput, type StatusView } from "../src/model/describe-status.ts"
import type { ConnectionVm, ObdErrorCode, PairError, RecorderVm, SyncErrorCode, SyncGlobalVm, TripSyncVm } from "../src/model/types.ts"

const NOW = 1_800_000_000_000
const langs: Lang[] = ["ru", "en"]

const errorCodes: ObdErrorCode[] = [
  "BluetoothUnavailable", "SerialUnavailable", "PermissionDenied", "DeviceNotSelected", "UnsupportedDevice",
  "AdapterNotResponding", "EcuNotResponding", "CommandTimeout", "CommandRejected", "Disconnected"
]
const connections: ConnectionVm[] = [
  { _tag: "Idle" }, { _tag: "RequestingDevice" }, { _tag: "Connecting" },
  { _tag: "InitializingAdapter", step: 2, total: 5, label: "ATE0" }, { _tag: "WaitingForEcu" },
  { _tag: "Ready", sensors: 4, supportedPids: ["0C"], fuelRateSource: "none", adapterName: "OBDII" },
  { _tag: "Lost", since: NOW - 12_000, attempt: 3, nextRetryAt: NOW + 4_000 },
  ...errorCodes.map((code): ConnectionVm => ({ _tag: "Failed", error: { code, step: "ATZ", reason: "adapter_off" } }))
]
const recorders: RecorderVm[] = [
  { _tag: "Idle" },
  { _tag: "Recording", tripId: "t", startedAt: NOW - 1_395_000, points: 1380, chunks: 4, lastSampleAt: NOW, gapOpen: false },
  { _tag: "Recording", tripId: "t", startedAt: NOW - 1_395_000, points: 1380, chunks: 4, lastSampleAt: NOW, gapOpen: true },
  { _tag: "Recording", tripId: "t", startedAt: NOW - 5000, points: 5, chunks: 0, lastSampleAt: NOW, gapOpen: false, storageError: "quota" },
  { _tag: "Recording", tripId: "t", startedAt: NOW - 5000, points: 5, chunks: 0, lastSampleAt: NOW, gapOpen: false, sourceEnded: true },
  { _tag: "Finishing" }, { _tag: "Error", message: "QuotaExceededError" }
]
const syncs: SyncGlobalVm[] = [
  { _tag: "Idle" }, { _tag: "Syncing" }, { _tag: "Offline" }, { _tag: "NeedsReauth", reason: "device_revoked" }, { _tag: "NeedsReauth", reason: "not_paired" },
  { _tag: "Blocked", code: "plugin_disabled" }, { _tag: "Blocked", code: "forbidden" }, { _tag: "Paused" }
]
const syncErrors: SyncErrorCode[] = ["network", "rate_limited", "server", "checksum_mismatch", "unauthorized", "unknown"]
const trips: TripSyncVm[] = [
  { _tag: "Recording" }, { _tag: "Queued" },
  { _tag: "Uploading", sent: 3, total: 14, confirmed: 2 },
  ...syncErrors.map((lastError): TripSyncVm => ({ _tag: "Waiting", sent: 12, total: 14, nextRetryAt: NOW + 40_000, lastError })),
  { _tag: "Verifying" }, { _tag: "Confirmed", at: NOW }, { _tag: "CloudOnly" },
  { _tag: "Incomplete", missing: [2], corrupt: [], conflict: [], localCopy: true },
  { _tag: "Incomplete", missing: [], corrupt: [4, 5], conflict: [], localCopy: true },
  { _tag: "Incomplete", missing: [], corrupt: [], conflict: [1], localCopy: true },
  { _tag: "Incomplete", missing: [1, 2], corrupt: [], conflict: [], localCopy: false }
]
const pairs: Array<"unpaired" | "progress" | "done" | PairError> = ["unpaired", "progress", "done", "invalid", "network", "blocked", "unknown"]

const all: StatusInput[] = [
  ...connections.map((state): StatusInput => ({ kind: "connection", state })),
  ...errorCodes.map((code): StatusInput => ({ kind: "error", code, step: "ATZ", reason: "x" })),
  { kind: "error", code: "BluetoothUnavailable", reason: "insecure_context" },
  { kind: "error", code: "BluetoothUnavailable", reason: "unsupported" },
  ...recorders.map((state): StatusInput => ({ kind: "recorder", state })),
  ...syncs.map((state): StatusInput => ({ kind: "sync", state })),
  ...trips.map((state): StatusInput => ({ kind: "trip", state })),
  { kind: "storage", level: "low", usedPct: 91 }, { kind: "storage", level: "notPersistent" },
  { kind: "clock", offsetMs: 600_000 },
  ...pairs.map((state): StatusInput => ({ kind: "pair", state }))
]

const check = (v: StatusView) => {
  expect(v.title.length).toBeGreaterThan(2)
  expect(v.text.length).toBeGreaterThan(5)
  for (const s of [v.title, v.text, v.summary ?? "", v.action?.label ?? ""]) {
    expect(s).not.toMatch(/\{\w+/)
    expect(s).not.toMatch(/^(err|trip|sync|conn|rec|env|action|pair)\./)
    expect(s).not.toContain("undefined")
  }
}

describe("describeStatus is exhaustive", () => {
  for (const lang of langs) {
    it(`gives title + explanation for every input (${lang})`, () => {
      for (const input of all) check(describeStatus(input, lang, NOW)!)
    })
  }
  it("covers every error code with a distinct human title", () => {
    for (const lang of langs) {
      const titles = new Set(errorCodes.map((code) => describeStatus({ kind: "error", code }, lang).title))
      expect(titles.size).toBe(errorCodes.length)
    }
  })
  it("trip statuses always have a one-line summary", () => {
    for (const lang of langs)
      for (const state of trips) expect(describeStatus({ kind: "trip", state }, lang, NOW).summary).toBeTruthy()
  })
})

describe("exact copy", () => {
  it("en waiting trip", () => {
    const v = describeStatus({ kind: "trip", state: { _tag: "Waiting", sent: 12, total: 14, nextRetryAt: NOW + 40_000, lastError: "network" } }, "en", NOW)
    expect(v.summary).toBe("Sent 12 of 14 parts · 2 waiting for network · next try in 40 s")
    expect(v.action?.id).toBe("retryNow")
  })
  it("ru waiting trip uses plural forms", () => {
    const v = describeStatus({ kind: "trip", state: { _tag: "Waiting", sent: 12, total: 14, nextRetryAt: NOW + 40_000, lastError: "network" } }, "ru", NOW)
    expect(v.summary).toBe("Отправлено 12 из 14 частей · ожидают 2: нет сети · следующая попытка через 40 с")
  })
  it("recording title has clock and points", () => {
    const v = describeStatus({ kind: "recorder", state: recorders[1]! }, "en", NOW)
    expect(v.title).toBe("Recording 00:23:15")
    expect(v.text).toBe("1,380 points · saved on the phone")
    expect(describeStatus({ kind: "recorder", state: recorders[1]! }, "ru", NOW).text).toContain("1 380 точек")
  })
  it("lost connection shows age and attempt", () => {
    const v = describeStatus({ kind: "connection", state: connections[6]! }, "en", NOW)
    expect(v.title).toBe("Connection lost 12 s ago")
    expect(v.text).toContain("attempt 3")
  })
})

describe("actions", () => {
  it("failed errors offer retry, missing Bluetooth offers demo", () => {
    expect(describeStatus({ kind: "error", code: "EcuNotResponding" }, "en").action?.id).toBe("retry")
    expect(describeStatus({ kind: "error", code: "SerialUnavailable" }, "en").action?.id).toBe("tryDemo")
  })
  it("revoked device points to pairing and mentions local data kept", () => {
    const v = describeStatus({ kind: "sync", state: { _tag: "NeedsReauth", reason: "device_revoked" } }, "en")
    expect(v.action?.id).toBe("howToPair")
    expect(v.text).toMatch(/kept/)
    expect(v.title).toMatch(/disconnected from your account/)
  })
  it("conflict -> export, corrupt/missing -> retry, lost local copy -> no action", () => {
    const inc = (p: Partial<Extract<TripSyncVm, { _tag: "Incomplete" }>>): TripSyncVm => ({ _tag: "Incomplete", missing: [], corrupt: [], conflict: [], localCopy: true, ...p })
    expect(describeStatus({ kind: "trip", state: inc({ conflict: [0] }) }, "en").action?.id).toBe("exportFile")
    expect(describeStatus({ kind: "trip", state: inc({ corrupt: [0] }) }, "en").action?.id).toBe("retryNow")
    expect(describeStatus({ kind: "trip", state: inc({ missing: [0] }) }, "en").action?.id).toBe("retryNow")
    const lost = describeStatus({ kind: "trip", state: inc({ missing: [0], localCopy: false }) }, "en")
    expect(lost.action).toBeUndefined()
    expect(lost.title).toMatch(/no copy on the phone/)
  })
  it("pairing errors", () => {
    expect(describeStatus({ kind: "pair", state: "invalid" }, "en").title).toMatch(/expired or was already used/)
    expect(describeStatus({ kind: "pair", state: "network" }, "en").action?.id).toBe("retry")
  })
})

describe("environment", () => {
  const caps = (ble: boolean, serial: boolean, secureContext = true) => ({ ble, serial, secureContext })
  it("returns null when recording is possible", () => {
    expect(describeStatus({ kind: "env", caps: caps(true, false), platform: "android", telegramWebview: false }, "en")).toBeNull()
    expect(describeStatus({ kind: "env", caps: caps(false, true), platform: "desktop", telegramWebview: false }, "en")).toBeNull()
  })
  it("Telegram WebView gets the specific message with an Open in Chrome action", () => {
    for (const lang of langs) {
      const v = describeStatus({ kind: "env", caps: caps(false, false), platform: "android", telegramWebview: true }, lang)!
      expect(v.action?.id).toBe("openInChrome")
      expect(v.text).toMatch(/Telegram/)
    }
  })
  it("other Android WebView, iOS, desktop, insecure", () => {
    expect(describeStatus({ kind: "env", caps: caps(false, false), platform: "android", telegramWebview: false }, "en")!.action?.id).toBe("openInChrome")
    expect(describeStatus({ kind: "env", caps: caps(false, false), platform: "ios", telegramWebview: true }, "en")!.title).toMatch(/iPhone/)
    expect(describeStatus({ kind: "env", caps: caps(false, false), platform: "desktop", telegramWebview: false }, "en")!.action).toBeUndefined()
    expect(describeStatus({ kind: "env", caps: caps(false, false, false), platform: "android", telegramWebview: false }, "ru")!.title).toMatch(/защищ/)
  })
})
