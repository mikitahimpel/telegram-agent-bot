import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import App from "../src/App.vue"
import { AppKey, createAppContext, type Route } from "../src/app-context.ts"
import { fixtureTrips, readyConn } from "../src/fixtures/index.ts"
import ChunkGrid from "../src/components/ChunkGrid.vue"
import type { Lang } from "../src/i18n/format.ts"
import ConnectScreen from "../src/screens/ConnectScreen.vue"
import HomeScreen from "../src/screens/HomeScreen.vue"
import InterruptedDialog from "../src/screens/InterruptedDialog.vue"
import OpenInChromeScreen from "../src/screens/OpenInChromeScreen.vue"
import PairScreen from "../src/screens/PairScreen.vue"
import RecordingScreen from "../src/screens/RecordingScreen.vue"
import SettingsScreen from "../src/screens/SettingsScreen.vue"
import TripDetailScreen from "../src/screens/TripDetailScreen.vue"
import TripsScreen from "../src/screens/TripsScreen.vue"
import { createDemoBackend, type DemoOptions } from "../src/services/demo-backend.ts"

const make = (o: DemoOptions = {}, lang: Lang = "en") => {
  localStorage.clear()
  const backend = createDemoBackend({ static: true, ...o })
  const ctx = createAppContext({ backend, lang, tickMs: 0 })
  return { backend, ctx, global: { provide: { [AppKey as symbol]: ctx } } }
}
const noCaps = { ble: false, serial: false, secureContext: true, inTelegram: false, reasons: [] }
const recording = { _tag: "Recording", tripId: "t", startedAt: Date.now() - 1_395_000, points: 1380, chunks: 4, distanceKm: 12.3, lastSampleAt: Date.now(), gapOpen: false } as const

describe("screens render with fixtures", () => {
  for (const lang of ["en", "ru"] as Lang[]) {
    describe(lang, () => {
      it("home", () => {
        const { global } = make({ trips: fixtureTrips() }, lang)
        const w = mount(HomeScreen, { global })
        expect(w.find('[data-testid="status-card"]').exists()).toBe(true)
        expect(w.findAll('[data-testid="trip-row"]').length).toBe(3)
      })
      it("connect wizard with failure + dev menu", async () => {
        const { global } = make({ conn: { _tag: "Failed", error: { code: "EcuNotResponding" } } }, lang)
        const w = mount(ConnectScreen, { global, props: { preset: "simulator" } })
        expect(w.findAll("[data-step]").length).toBe(5)
        expect(w.find('[data-status="failed"]').text()).toMatch(/./)
        for (let i = 0; i < 5; i++) await w.find('[data-testid="connect-title"]').trigger("click")
        expect(w.find('[data-testid="dev-menu"]').exists()).toBe(true)
      })
      it("recording with gap, unsupported fuel and estimate", () => {
        const { global } = make({ rec: { ...recording, gapOpen: true }, conn: { _tag: "Lost", since: Date.now() - 12_000, attempt: 3, nextRetryAt: Date.now() + 5000 }, supported: ["speedKmh", "rpm"] }, lang)
        const w = mount(RecordingScreen, { global })
        expect(w.findAll('[data-testid="status-card"]').length).toBe(2)
        expect(w.find('[data-sensor="fuelRateLph"]').classes()).toContain("off")
        expect(w.find('[data-sensor="coolantC"]').text()).toMatch(/./)
      })
      it("trips list puts attention first", () => {
        const { global } = make({ trips: fixtureTrips() }, lang)
        const w = mount(TripsScreen, { global })
        const groups = w.findAll("[data-testid^=group-]").map((g) => g.attributes("data-testid"))
        expect(groups[0]).toBe("group-attention")
      })
      it("trip detail: counters, grid, actions", async () => {
        const trip = fixtureTrips()[0]!
        const { global } = make({ trips: fixtureTrips() }, lang)
        const w = mount(TripDetailScreen, { global, props: { tripId: trip.tripId } })
        expect(w.find('[data-testid="counters"]').text()).toMatch(/12\/14/)
        expect(w.findAll(".cell").length).toBe(14)
        await w.findAll(".cell")[13]!.trigger("click")
        expect(w.find('[data-testid="chunk-info"]').exists()).toBe(true)
        expect(w.find('[data-testid="delete"]').attributes("disabled")).toBeDefined()
        expect(w.find('[data-testid="gaps"]').text()).toMatch(/./)
      })
      it("settings", () => {
        const { global } = make({}, lang)
        const w = mount(SettingsScreen, { global })
        expect(w.find('[data-testid="storage"]').text()).toMatch(/./)
        expect(w.find('[data-testid="diag"]').text()).toMatch(/ATZ/)
      })
      it("interrupted dialog", () => {
        const { global } = make({ interrupted: { tripId: "x", interruptedAt: Date.now(), points: 500 } }, lang)
        expect(mount(InterruptedDialog, { global }).find('[data-testid="interrupted"]').exists()).toBe(true)
      })
      it("pair screen states", () => {
        for (const pairing of ["unpaired", "progress", "invalid", "network", "blocked", "unknown"] as const) {
          const { global } = make({ pairing }, lang)
          expect(mount(PairScreen, { global }).find('[data-testid="status-card"]').text()).toMatch(/./)
        }
      })
      it("unsupported browser screen offers Open in Chrome on Android only", () => {
        const a = make({ caps: noCaps, platform: "android" }, lang)
        expect(mount(OpenInChromeScreen, { global: a.global }).find('[data-testid="status-action"]').exists()).toBe(true)
        const i = make({ caps: noCaps, platform: "ios" }, lang)
        expect(mount(OpenInChromeScreen, { global: i.global }).find('[data-testid="status-action"]').exists()).toBe(false)
      })
    })
  }
  it("chunk grid legend lists all states", () => {
    const { global } = make()
    const w = mount(ChunkGrid, { global, props: { chunks: fixtureTrips()[2]!.chunks } })
    expect(w.findAll(".legend li").length).toBe(7)
  })
})

describe("App gating and banners", () => {
  it("WebView: unsupported screen; pairing not shown", () => {
    const { global } = make({ caps: noCaps, platform: "android", pairing: "unpaired" })
    const w = mount(App, { global })
    expect(w.find('[data-testid="open-in-chrome"]').exists()).toBe(true)
    expect(w.find('[data-testid="pair-screen"]').exists()).toBe(false)
  })
  it("WebView: open-in-Chrome button appears once", () => {
    const { global } = make({ caps: noCaps, platform: "android", pairing: "unpaired" })
    const w = mount(App, { global })
    expect(w.findAll("button").filter((b) => b.text() === "Open in Chrome" || b.text() === "Открыть в Chrome")).toHaveLength(1)
  })
  it("unpaired: record locally reveals the app with a persistent banner", async () => {
    const { global } = make({ pairing: "unpaired" })
    const w = mount(App, { global })
    expect(w.find('[data-testid="pair-screen"]').text()).toContain("/car app")
    await w.find('[data-testid="record-local"]').trigger("click")
    expect(w.find('[data-testid="pair-screen"]').exists()).toBe(false)
    expect(w.find('[data-testid="banners"]').exists()).toBe(true)
  })
  it("Chrome unpaired: pair screen", () => {
    const { global } = make({ pairing: "unpaired", conn: { _tag: "Idle" } })
    expect(mount(App, { global }).find('[data-testid="pair-screen"]').exists()).toBe(true)
  })
  it("paired: shell with banners for offline, revoked, storage, clock", () => {
    const { global, ctx } = make({
      pairing: "paired", online: false, sync: { _tag: "NeedsReauth", reason: "device_revoked" },
      storage: { usedBytes: 90, quotaBytes: 100, persisted: false }, clockOffsetMs: 5 * 60_000, conn: readyConn
    })
    const w = mount(App, { global })
    expect(w.findAll('[data-testid="banners"] [data-testid="status-card"]').length).toBe(4)
    expect(ctx.route.value.name).toBe("home")
    expect(w.find('[data-testid="primary"]').text()).toBe("Start recording")
  })
  it("starting a recording navigates to the recording screen", async () => {
    const { global, ctx } = make({ pairing: "paired", conn: readyConn })
    const w = mount(App, { global })
    await ctx.perform("start")
    await w.vm.$nextTick()
    expect((ctx.route.value as Route).name).toBe("recording")
  })
})
