import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, it } from "vite-plus/test"
import { AppKey, createAppContext, parseRouteHash } from "../src/app-context.ts"
import TimeChart from "../src/components/insights/TimeChart.vue"
import { buildOverviewFixture, buildTripFixture } from "../src/fixtures/insights.ts"
import type { Lang } from "../src/i18n/format.ts"
import { fuelSummary, verdictOf } from "../src/model/insights.ts"
import AlertsScreen from "../src/screens/AlertsScreen.vue"
import BatteryScreen from "../src/screens/BatteryScreen.vue"
import EngineScreen from "../src/screens/EngineScreen.vue"
import OnboardingScreen from "../src/screens/OnboardingScreen.vue"
import OverviewScreen from "../src/screens/OverviewScreen.vue"
import StatsScreen from "../src/screens/StatsScreen.vue"
import TripDetailScreen from "../src/screens/TripDetailScreen.vue"
import { createDemoBackend, type DemoOptions } from "../src/services/demo-backend.ts"
import { InsightsError } from "../src/services/insights-api.ts"
import { fixtureTrips } from "../src/fixtures/index.ts"

const make = (o: DemoOptions = {}, lang: Lang = "en") => {
  localStorage.clear()
  const backend = createDemoBackend({ static: true, ...o })
  const ctx = createAppContext({ backend, lang, tickMs: 0 })
  return { backend, ctx, global: { provide: { [AppKey as symbol]: ctx } } }
}
const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises()
}
const NOW = Date.UTC(2026, 10, 19, 12)

describe("route hash", () => {
  it("parses insight links and ignores pairing", () => {
    expect(parseRouteHash("#overview")).toEqual({ name: "overview" })
    expect(parseRouteHash("#engine")).toEqual({ name: "engine" })
    expect(parseRouteHash("#trip=20261119T100000Z-ab12cd34")).toEqual({
      name: "trip",
      tripId: "20261119T100000Z-ab12cd34"
    })
    expect(parseRouteHash("#pair=abc")).toBeNull()
    expect(parseRouteHash("")).toBeNull()
  })
})

describe("fixtures", () => {
  it("trip insight is consistent with its series and keeps gaps", () => {
    const { insight, series } = buildTripFixture({
      tripId: "20261119T100000Z-ab12cd34",
      startedAt: NOW,
      durationS: 41 * 60
    })
    expect(series.gaps).toHaveLength(1)
    const g = series.gaps[0]!
    expect(series.ts.some((t) => t > g.from && t < g.to)).toBe(false)
    expect(series.ts.length).toBeGreaterThan(400)
    expect(insight.complete).toBe(false)
    expect(insight.movingS + insight.idleS).toBeLessThanOrEqual(insight.durationS)
    expect(insight.distanceKm).toBeGreaterThan(5)
    expect(insight.fuelPer100Km).toBeGreaterThan(3)
  })
  it("a car without fuel data reports null fuel", () => {
    const { insight, series } = buildTripFixture({
      tripId: "20261118T081500Z-ee55aa01",
      startedAt: NOW,
      durationS: 22 * 60
    })
    expect(insight.fuelL).toBeNull()
    expect(series.columns.fuel_rate_lph!.every((v) => v === null)).toBe(true)
  })
  it("verdict reflects the worst severity; healthy is ok; fuel compares with usual", () => {
    expect(verdictOf(buildOverviewFixture("issues", "en", NOW))).toBe("soon")
    expect(verdictOf(buildOverviewFixture("healthy", "en", NOW))).toBe("ok")
    const empty = {
      ...buildOverviewFixture("healthy", "en", NOW),
      totals: { ...buildOverviewFixture("healthy", "en", NOW).totals, trips: 0 },
      battery: { ...buildOverviewFixture("healthy", "en", NOW).battery, status: "unknown" as const },
      engine: { ...buildOverviewFixture("healthy", "en", NOW).engine, lastScanAt: null, activeCodes: [], milOn: false },
      alerts: []
    }
    expect(verdictOf(empty)).toBe("nodata")
    const f = fuelSummary(buildOverviewFixture("issues", "en", NOW).byWeek)
    expect(f?.usual).toBeGreaterThan(7)
    expect(f?.deltaPct).toBeGreaterThan(5)
  })
})

describe("TimeChart", () => {
  const props = (over: Record<string, unknown> = {}) => ({
    label: "Speed",
    ts: [0, 1000, 2000, 7000, 8000],
    values: [10, 20, 30, 40, 50],
    gaps: [{ from: 2000, to: 7000 }],
    domain: [0, 8000] as const,
    hover: null,
    format: (n: number) => `${n} km/h`,
    axisFormat: (n: number) => String(n),
    xFormat: (n: number) => String(n),
    ...over
  })
  it("never draws a line across a gap", () => {
    const { global } = make()
    const w = mount(TimeChart, { global, props: props() })
    expect(w.findAll("path.stroke")).toHaveLength(2)
    expect(w.findAll('[data-testid="chart-gap"]')).toHaveLength(1)
  })
  it("breaks on null values and shows a crosshair readout", async () => {
    const { global } = make()
    const w = mount(TimeChart, { global, props: props({ values: [10, null, 30, 40, 50], gaps: [], hover: 7000 }) })
    expect(w.findAll("path.stroke")).toHaveLength(1)
    expect(w.find('[data-testid="chart-readout"]').text()).toBe("40 km/h")
    await w.setProps({ hover: 3000 })
    expect(w.find(".cross").exists()).toBe(true)
  })
  it("says no data inside a gap", () => {
    const { global } = make()
    const w = mount(TimeChart, { global, props: props({ hover: 4000 }) })
    expect(w.find('[data-testid="chart-readout"]').text()).toBe("no data")
  })
})

describe("insight screens", () => {
  for (const lang of ["en", "ru"] as Lang[]) {
    describe(lang, () => {
      it("overview shows verdict, engine, battery, fuel, last trip and alerts", async () => {
        const { global } = make({ trips: fixtureTrips() }, lang)
        const w = mount(OverviewScreen, { global })
        await settle()
        expect(w.find('[data-testid="verdict"]').attributes("data-verdict")).toBe("soon")
        expect(w.find('[data-testid="engine-value"]').text()).toMatch(/2/)
        expect(w.find('[data-testid="card-battery"]').text()).toMatch(/V|В/)
        expect(w.find('[data-testid="card-fuel"]').text()).toMatch(/L\/100|л\/100/)
        expect(w.find('[data-testid="card-trip"]').text()).toMatch(/km|км/)
        expect(w.findAll(".alert-row").length).toBe(3)
      })
      it("overview of a healthy car has the calm state", async () => {
        const { global } = make({ insights: "healthy" }, lang)
        const w = mount(OverviewScreen, { global })
        await settle()
        expect(w.find('[data-testid="verdict"]').attributes("data-verdict")).toBe("ok")
        expect(w.find('[data-testid="no-alerts"]').exists()).toBe(true)
      })
      it("engine lists codes with severity and can-drive; empty state when healthy", async () => {
        const a = make({}, lang)
        const w = mount(EngineScreen, { global: a.global })
        await settle()
        expect(w.findAll('[data-testid="dtc"]')).toHaveLength(2)
        expect(w.find('[data-testid="can-drive"]').text()).toMatch(/./)
        expect(w.find('[data-severity="soon"]').exists()).toBe(true)
        expect(w.find('[data-testid="engine-history"]').exists()).toBe(true)
        await w.find('[data-testid="scan"]').trigger("click")
        await settle()
        const b = make({ insights: "healthy" }, lang)
        const h = mount(EngineScreen, { global: b.global })
        await settle()
        expect(h.find('[data-testid="engine-clear"]').exists()).toBe(true)
        expect(h.findAll('[data-testid="dtc"]')).toHaveLength(0)
      })
      it("battery shows two charts and status", async () => {
        const { global } = make({}, lang)
        const w = mount(BatteryScreen, { global })
        await settle()
        expect(w.find('[data-testid="battery-status"]').text()).toMatch(/./)
        expect(w.find('[data-testid="chart-bat-rest"]').exists()).toBe(true)
        expect(w.find('[data-testid="chart-bat-crank"]').exists()).toBe(true)
        expect(w.find('[data-testid="resting-v"]').text()).toMatch(/V|В/)
      })
      it("stats switches period and metric and has a table", async () => {
        const { global } = make({}, lang)
        const w = mount(StatsScreen, { global })
        await settle()
        expect(w.findAll(".bar")).toHaveLength(10)
        await w.find('[data-testid="period-month"]').trigger("click")
        expect(w.findAll(".bar")).toHaveLength(6)
        await w.find('[data-testid="metric-fuelPer100Km"]').trigger("click")
        expect(w.find('[data-testid="bars-caption"]').text()).toMatch(/L\/100|л\/100/)
        expect(w.findAll('[data-testid="stats-table"] tbody tr')).toHaveLength(6)
      })
      it("alerts list with what to do and resolved fold", async () => {
        const { global } = make({}, lang)
        const w = mount(AlertsScreen, { global })
        await settle()
        expect(w.findAll('[data-testid="alert"]')).toHaveLength(3)
        expect(w.find('[data-testid="alerts-resolved"]').exists()).toBe(true)
      })
      it("trip detail: numbers, route, five synced charts with a gap, bands, collapsed transfer", async () => {
        const trip = fixtureTrips()[0]!
        const { global } = make({ trips: fixtureTrips() }, lang)
        const w = mount(TripDetailScreen, { global, props: { tripId: trip.tripId } })
        await settle()
        expect(w.find('[data-testid="trip-distance"]').text()).toMatch(/km|км/)
        expect(w.find('[data-testid="partial-note"]').exists()).toBe(true)
        expect(w.find('[data-testid="route"]').exists()).toBe(true)
        for (const id of ["speed", "rpm", "coolant", "fuel", "voltage"])
          expect(w.find(`[data-testid="chart-${id}"]`).exists()).toBe(true)
        expect(w.findAll('[data-testid="chart-gap"]').length).toBe(5)
        expect(w.findAll('[data-testid="trip-bands"] li').length).toBeGreaterThan(2)
        expect(w.find('[data-testid="transfer"]').attributes("open")).toBeUndefined()
        await w.find('[data-testid="chart-speed"] svg').trigger("pointermove", { clientX: 100 })
        expect(w.findAll('[data-chart-hover="on"]')).toHaveLength(5)
      })
      it("trip without fuel data explains the missing chart", async () => {
        const { global } = make({ trips: fixtureTrips() }, lang)
        const w = mount(TripDetailScreen, { global, props: { tripId: fixtureTrips()[1]!.tripId } })
        await settle()
        expect(w.find('[data-testid="chart-fuel-missing"]').exists()).toBe(true)
        expect(w.find('[data-testid="trip-fuel"]').text()).toMatch(/./)
      })
      it("onboarding walks through steps and warns about classic Bluetooth", async () => {
        const { global } = make({}, lang)
        const w = mount(OnboardingScreen, { global })
        await w.find('[data-testid="ob-need"]').trigger("click")
        expect(w.find('[data-testid="ob-warning"]').exists()).toBe(true)
        for (let i = 0; i < 4; i++) await w.find('[data-testid="ob-next"]').trigger("click")
        expect(w.find('[data-testid="ob-done"]').exists()).toBe(true)
      })
    })
  }
  it("unpaired phone is asked to connect and can open an example", async () => {
    localStorage.clear()
    const base = createDemoBackend({ static: true })
    const backend = {
      ...base,
      overview: (lang: Lang) =>
        base.insightsDemo.value ? base.overview(lang) : Promise.reject(new InsightsError("not_paired"))
    }
    base.insightsDemo.value = false
    const ctx = createAppContext({ backend, lang: "en", tickMs: 0 })
    const w = mount(OverviewScreen, { global: { provide: { [AppKey as symbol]: ctx } } })
    await settle()
    expect(w.find('[data-testid="not-paired"]').exists()).toBe(true)
    await w.find('[data-testid="see-example"]').trigger("click")
    await settle()
    expect(w.find('[data-testid="verdict"]').exists()).toBe(true)
    expect(w.find('[data-testid="demo-chip"]').exists()).toBe(true)
  })
})

describe("auto mode strip", () => {
  it("shows the one-line status for each state and its single action", async () => {
    const cases = [
      [{ _tag: "WaitingForEngine", adapterName: "OBDII" }, "Всё работает", null],
      [{ _tag: "NeedsTap", reason: "first_use" }, "адаптер", "auto.chooseAdapter"],
      [
        { _tag: "Recording", tripId: "x", startedAt: Date.now() - 5000, adapterName: "OBDII", linkLostSince: null },
        "Идёт запись",
        null
      ],
      [
        {
          _tag: "Recording",
          tripId: "x",
          startedAt: Date.now() - 5000,
          adapterName: "OBDII",
          linkLostSince: Date.now()
        },
        "потеряна",
        null
      ],
      [{ _tag: "AutoStopped", tripId: "x", startedAt: 1, endedAt: 2 }, "сохранена", "auto.stopped.open"]
    ] as const
    const RecorderStrip = (await import("../src/components/insights/RecorderStrip.vue")).default
    for (const [auto, text, action] of cases) {
      const { global } = make({ auto: auto as never }, "ru")
      const w = mount(RecorderStrip, { global })
      expect(w.text()).toContain(text)
      expect(w.find('[data-testid="strip-action"]').exists()).toBe(action !== null)
    }
  })
})
