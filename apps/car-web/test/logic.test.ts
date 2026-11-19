import { describe, expect, it, vi } from "vitest"
import { formatMessage } from "../src/i18n/format.ts"
import { en } from "../src/i18n/en.ts"
import { ru } from "../src/i18n/ru.ts"
import { describeHome } from "../src/model/home.ts"
import { groupTrips, canDeleteLocal } from "../src/model/trips.ts"
import { wizardSteps } from "../src/model/wizard.ts"
import { fixtureTrips, readyConn } from "../src/fixtures/index.ts"
import { botUrl, buildChromeIntentUrl } from "../src/services/env.ts"
import { completePair, deviceNameFromUA, parsePairHash } from "../src/services/pairing.ts"
import { runPairing } from "../src/services/pairing-flow.ts"
import { createDemoBackend } from "../src/services/demo-backend.ts"
import { ConnectionState } from "@bot/car-obd/state"
import { mapConnectionState, mapObdError } from "../src/services/map-obd.ts"
import { mapChunkState, mapSyncError, mapTrip, mapRecorderState } from "../src/services/map-recorder.ts"

const caps = { ble: true, serial: false, secureContext: true }
const NOW = 1_800_000_000_000

describe("i18n", () => {
  it("ru and en have identical keys and the same placeholders", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
    const ph = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort().join(",")
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(ru[k]), k).toBe(ph(en[k]))
  })
  it("plurals", () => {
    const f = "{n#часть|части|частей}"
    expect(formatMessage("ru", f, { n: 1 })).toBe("1 часть")
    expect(formatMessage("ru", f, { n: 3 })).toBe("3 части")
    expect(formatMessage("ru", f, { n: 11 })).toBe("11 частей")
    expect(formatMessage("ru", f, { n: 21 })).toBe("21 часть")
    expect(formatMessage("en", "{n#part|parts}", { n: 1 })).toBe("1 part")
    expect(formatMessage("en", "{n#part|parts}", { n: 2 })).toBe("2 parts")
  })
})

describe("wizard live progress", () => {
  it("advances as connection states arrive", () => {
    const states = [
      ConnectionState.RequestingDevice(),
      ConnectionState.Connecting({ deviceName: "OBDII" }),
      ConnectionState.InitializingAdapter({ step: 2, total: 5, label: "ATE0" }),
      ConnectionState.WaitingForEcu(),
      ConnectionState.Ready({
        info: { adapterName: "OBDII", elmVersion: "v", obdProtocol: "p", supportedPids: ["0C"], fuelRateSource: "none", transport: "simulator" }
      })
    ]
    const active = states.map((s) => wizardSteps(mapConnectionState(s), caps, "ble", "en").findIndex((w) => w.status === "active"))
    expect(active).toEqual([2, 3, 3, 4, -1])
    const init = wizardSteps(mapConnectionState(states[2]!), caps, "ble", "en")
    expect(init[3]!.note).toBe("2/5 ATE0")
  })
})

describe("wizard", () => {
  it("marks the failing step with a human problem", () => {
    const steps = wizardSteps({ _tag: "Failed", error: { code: "EcuNotResponding" } }, caps, "ble", "en")
    expect(steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "failed", "pending"])
    expect(steps[4]!.problem?.title).toBe("The car does not answer")
  })
  it("walks forward and ends with sensor count", () => {
    expect(wizardSteps({ _tag: "RequestingDevice" }, caps, "ble", "en").map((s) => s.status)).toEqual(["done", "done", "active", "pending", "pending", "pending"])
    const ready = wizardSteps(readyConn, caps, "ble", "en")
    expect(ready.every((s) => s.status === "done")).toBe(true)
    expect(ready[5]!.note).toBe("4 sensors found")
  })
  it("denied permission fails at choose", () => {
    expect(wizardSteps({ _tag: "Failed", error: { code: "PermissionDenied" } }, caps, "ble", "en")[2]!.status).toBe("failed")
  })
})

describe("home + trips", () => {
  const base = { conn: { _tag: "Idle" } as const, rec: { _tag: "Idle" } as const, sync: { _tag: "Idle" } as const }
  it("attention beats everything but an active recording", () => {
    const v = describeHome({ ...base, trips: fixtureTrips(NOW) }, "en", NOW)
    expect(v.action?.id).toBe("openTrip")
  })
  it("aggregates pending uploads", () => {
    const v = describeHome({ ...base, trips: fixtureTrips(NOW).slice(0, 1) }, "en", NOW)
    expect(v.title).toBe("Sending 12 of 14 parts")
  })
  it("all confirmed -> everything in the cloud", () => {
    const v = describeHome({ ...base, trips: fixtureTrips(NOW).slice(1, 2) }, "en", NOW)
    expect(v.title).toBe("Everything is in the cloud")
  })
  it("groups with attention first and delete only when confirmed", () => {
    const g = groupTrips(fixtureTrips(NOW))
    expect(g.attention).toHaveLength(2)
    expect(g.done).toHaveLength(1)
    const ts = fixtureTrips(NOW)
    expect(canDeleteLocal(ts[1]!)).toBe(true)
    expect(canDeleteLocal(ts[0]!)).toBe(false)
  })
})

describe("bot link", () => {
  it("builds the t.me url from the env username", () => {
    expect(botUrl("my_bot")).toBe("https://t.me/my_bot")
    expect(botUrl("@my_bot")).toBe("https://t.me/my_bot")
    expect(botUrl(undefined)).toBeNull()
    expect(botUrl("")).toBeNull()
  })
})

describe("pairing + chrome intent", () => {
  it("parses hash", () => {
    expect(parsePairHash("#pair=AbC123")).toBe("AbC123")
    expect(parsePairHash("#x=1&pair=zz9")).toBe("zz9")
    expect(parsePairHash("")).toBeNull()
  })
  it("device name from UA", () => {
    expect(deviceNameFromUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome · Pixel 8")
  })
  it("intent url keeps the pair hash", () => {
    expect(buildChromeIntentUrl({ host: "bot.example.com", pathname: "/car/", hash: "#pair=ABC" })).toBe(
      "intent://bot.example.com/car/#pair=ABC#Intent;scheme=https;package=com.android.chrome;end"
    )
  })
  const res = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })
  it("maps pairing outcomes", async () => {
    expect(await completePair("/a", "c", "n", res(200, { deviceToken: "t", deviceId: "d", tgId: 1, firstName: "A" }) as never)).toMatchObject({ ok: true })
    expect(await completePair("/a", "c", "n", res(400, { error: { code: "pair_code_invalid" } }) as never)).toEqual({ ok: false, error: "invalid" })
    expect(await completePair("/a", "c", "n", res(403, { error: { code: "plugin_disabled" } }) as never)).toEqual({ ok: false, error: "blocked" })
    expect(await completePair("/a", "c", "n", res(503, {}) as never)).toEqual({ ok: false, error: "network" })
    expect(await completePair("/a", "c", "n", (async () => { throw new Error("x") }) as never)).toEqual({ ok: false, error: "network" })
  })
  it("a WebView (no BLE/serial) never consumes the code", async () => {
    const backend = createDemoBackend({ caps: { ble: false, serial: false, secureContext: true, inTelegram: false, reasons: [] }, pairing: "unpaired" })
    const fetchFn = vi.fn()
    await runPairing(backend, { hash: "#pair=ABC", ua: "x", apiBase: "/car/api", fetchFn: fetchFn as never, stripHash: () => {} })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(backend.pairing.value).toBe("unpaired")
  })
  it("Chrome completes pairing and strips the hash; invalid code strips and reports", async () => {
    const strip = vi.fn()
    const backend = createDemoBackend({ pairing: "unpaired" })
    await runPairing(backend, { hash: "#pair=ABC", ua: "x", apiBase: "/car/api", fetchFn: res(400, { error: { code: "pair_code_invalid" } }) as never, stripHash: strip })
    expect(backend.pairing.value).toBe("invalid")
    expect(strip).toHaveBeenCalled()
    const strip2 = vi.fn()
    await runPairing(backend, { hash: "#pair=ABC", ua: "x", apiBase: "/car/api", fetchFn: (async () => { throw new Error("offline") }) as never, stripHash: strip2 })
    expect(backend.pairing.value).toBe("network")
    expect(strip2).not.toHaveBeenCalled()
  })
})

describe("obd mapping", () => {
  it("maps tagged errors to view-model errors", () => {
    expect(mapObdError({ _tag: "AdapterNotResponding", step: "ATZ", lastResponse: "ÿ", code: "adapter_not_responding" } as never)).toMatchObject({ code: "AdapterNotResponding", step: "ATZ" })
    expect(mapObdError({ _tag: "BluetoothUnavailable", reason: "adapter_off", code: "bluetooth_unavailable" } as never)).toMatchObject({ code: "BluetoothUnavailable", reason: "adapter_off" })
  })
})

describe("recorder mapping", () => {
  it("maps chunk and error states", () => {
    expect(mapChunkState("pending")).toBe("waiting")
    expect(mapChunkState("uploading")).toBe("sent")
    expect(mapChunkState("lost")).toBe("lost")
    expect(mapSyncError("network error: Failed to fetch")).toBe("network")
    expect(mapSyncError("rate_limited")).toBe("rate_limited")
    expect(mapSyncError("???")).toBe("unknown")
  })
  it("builds Incomplete lists from chunk states", () => {
    const v = mapTrip(
      {
        tripId: "t", startedAt: 1, endedAt: 2, points: 10, distanceKm: undefined, cloud: undefined,
        sync: { _tag: "Incomplete", missing: 1, corrupt: 0, conflict: 0, localCopy: false } as never,
        chunks: [{ seq: 0, rows: 5, state: "confirmed", attempts: 1, nextRetryAt: undefined, lastError: undefined }, { seq: 1, rows: 5, state: "lost", attempts: 1, nextRetryAt: undefined, lastError: undefined }]
      },
      [], NOW
    )
    expect(v.sync).toMatchObject({ _tag: "Incomplete", missing: [1], localCopy: false })
    expect(v.localCopy).toBe(false)
  })
  it("maps recording state", () => {
    expect(mapRecorderState({ _tag: "Recording", tripId: "t", startedAt: 5, points: 1, chunks: 0, lastSampleAt: undefined, gapOpen: false, sourceEnded: false, storageError: "quota", geo: "off", wakeLock: true } as never)).toMatchObject({ lastSampleAt: 5, storageError: "quota" })
  })
})
