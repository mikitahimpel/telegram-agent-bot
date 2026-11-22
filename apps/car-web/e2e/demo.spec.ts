import { expect, test, type Page } from "@playwright/test"

const SHOTS = "e2e/screenshots"

const trackErrors = (page: Page): string[] => {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

const gaugeText = (page: Page, key: string) => page.locator(`[data-sensor="${key}"] .gauge-value`).innerText()

test("unpaired phone: demo connect, record, stop, trip with distance", async ({ page }) => {
  const errors = trackErrors(page)
  page.on("dialog", (d) => void d.accept())
  await page.goto("/car/")

  await expect(page.getByTestId("pair-screen")).toBeVisible()
  await expect(page.getByTestId("open-bot")).toHaveAttribute("href", "https://t.me/car_test_bot")
  await page.screenshot({ path: `${SHOTS}/01-pair.png` })

  await page.getByTestId("pair-demo").click()
  await expect(page.getByTestId("connect-title")).toBeVisible()
  await expect(page.getByTestId("pair-screen")).toHaveCount(0)

  const steps = page.locator('[data-testid="wizard"] li')
  await expect(steps).toHaveCount(5)
  await expect(page.locator('[data-testid="wizard"]').getByText("Демо", { exact: false })).toHaveCount(1)
  await page.screenshot({ path: `${SHOTS}/02-connect.png` })

  await page.getByTestId("connect-go").click()
  await expect(page.locator('[data-step="sensors"]')).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await expect(pageNotPair(page)).resolves.toBe(true)
  await page.screenshot({ path: `${SHOTS}/03-ready.png` })

  await page.getByTestId("connect-start").click()
  await expect(page.getByTestId("gauges")).toBeVisible()
  await expect.poll(() => gaugeText(page, "speedKmh"), { timeout: 15_000 }).toMatch(/\d/)
  const points = () => page.locator('[data-testid="facts"] div', { hasText: "Точек" }).locator("b").innerText()
  await expect.poll(async () => Number((await points()).replace(/\D/g, "")), { timeout: 15_000 }).toBeGreaterThan(2)
  const first = Number((await points()).replace(/\D/g, ""))
  await expect.poll(async () => Number((await points()).replace(/\D/g, "")), { timeout: 15_000 }).toBeGreaterThan(first)
  await expect(page.getByTestId("distance").locator("b")).not.toHaveText(/^0 км$/, { timeout: 20_000 })
  await page.screenshot({ path: `${SHOTS}/04-recording.png` })

  await page.getByTestId("primary").click()
  await expect(page.getByTestId("gauges")).toHaveCount(0, { timeout: 20_000 })

  await page.getByRole("button", { name: "Поездки", exact: true }).click()
  const row = page.getByTestId("trip-row").first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toContainText("км")
  await expect(row).not.toContainText("расстояние неизвестно")
  await expect(row).toContainText("Ждёт подключения телефона к аккаунту")
  await expect(row).not.toContainText("скоро начнётся")
  await page.screenshot({ path: `${SHOTS}/05-trips.png` })
  await row.click()
  await expect(page.getByTestId("trip-distance")).toContainText("км", { timeout: 15_000 })
  await page.getByTestId("transfer").locator("summary").click()
  const recorded = await page.locator('[data-testid="counters"] .counter b').first().innerText()
  expect(Number(recorded.replace(/\D/g, ""))).toBeGreaterThan(0)
  await expect(page.getByTestId("status-card").first()).toContainText("Ждёт подключения телефона к аккаунту")
  const grid = page.locator(".chunk-grid, [data-testid='chunk-grid']").first()
  await grid.scrollIntoViewIfNeeded()
  await expect(grid).toBeVisible()
  await expect(page.getByTestId("primary")).toHaveCount(0)
  const box = (await grid.boundingBox())!
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("nav.tabs, .primary-bar") !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  )
  expect(hit).toBe(false)
  await page.screenshot({ path: `${SHOTS}/06-trip.png` })

  expect(errors).toEqual([])
})

const pageNotPair = async (page: Page) => (await page.getByTestId("pair-screen").count()) === 0

test("unpaired, local mode: compact banners, content above the fold, tabs do not overlap", async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto("/car/")
  await page.getByTestId("record-local").click()
  await expect(page.getByTestId("banner-unpaired")).toBeVisible()
  const banner = await page.getByTestId("banner-unpaired").boundingBox()
  expect(banner!.height).toBeLessThan(56)
  await expect(page.getByTestId("banner-persist")).toHaveCount(0)
  const card = await page.getByTestId("status-card").first().boundingBox()
  expect(card!.y + card!.height).toBeLessThan(844)
  await page.screenshot({ path: `${SHOTS}/07-local-home.png` })

  await page.getByTestId("primary").click()
  await page.getByTestId("transport-simulator").click()
  await page.getByTestId("connect-go").click()
  await expect(page.locator('[data-step="sensors"]')).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await expect(page.getByTestId("pair-screen")).toHaveCount(0)

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const lastBottom = await page.evaluate(() => {
    const kids = [...document.querySelectorAll("main .screen > *")]
    return Math.max(...kids.map((k) => k.getBoundingClientRect().bottom))
  })
  const tabsTop = await page.locator("nav.tabs").evaluate((n) => n.getBoundingClientRect().top)
  expect(lastBottom).toBeLessThanOrEqual(tabsTop)
  expect(errors).toEqual([])
})

test.describe("WebView", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36"
  })
  test("no Web Bluetooth: a single Open in Chrome button", async ({ page }) => {
    const errors = trackErrors(page)
    await page.addInitScript(() => {
      for (const k of ["bluetooth", "serial"])
        Object.defineProperty(Navigator.prototype, k, { value: undefined, configurable: true })
    })
    await page.goto("/car/")
    await expect(page.getByTestId("open-in-chrome")).toBeVisible()
    await expect(page.getByRole("button", { name: "Открыть в Chrome" })).toHaveCount(1)
    await page.screenshot({ path: `${SHOTS}/08-webview.png` })
    expect(errors).toEqual([])
  })
})

const openDemo = async (page: Page) => {
  await page.goto("/car/")
  await page.getByTestId("pair-demo").click()
  await expect(page.getByTestId("connect-title")).toBeVisible()
}

test("demo insights: overview, trip charts, engine, battery, stats", async ({ page }) => {
  const errors = trackErrors(page)
  await openDemo(page)
  await page.getByTestId("tab-overview").click()
  await expect(page.getByTestId("verdict")).toBeVisible()
  await expect(page.getByTestId("demo-chip")).toBeVisible()
  await expect(page.getByTestId("card-engine")).toContainText("2 ошибки")
  await expect(page.getByTestId("card-battery")).toContainText("В")
  await expect(page.getByTestId("card-fuel")).toContainText("л/100 км")
  await page.screenshot({ path: `${SHOTS}/10-overview.png`, fullPage: true })

  await page.getByTestId("card-trip").click()
  await expect(page.getByTestId("trip-numbers")).toBeVisible()
  await expect(page.getByTestId("trip-distance")).toContainText("км")
  await expect(page.getByTestId("route")).toBeVisible()
  const speed = page.getByTestId("chart-speed")
  await speed.scrollIntoViewIfNeeded()
  await expect(speed.getByTestId("chart-gap")).toHaveCount(1)
  const box = (await speed.locator("svg").boundingBox())!
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
  await expect(page.locator('[data-chart-hover="on"]')).toHaveCount(5)
  await expect(page.getByTestId("chart-readout").first()).toContainText("км/ч")
  await page.screenshot({ path: `${SHOTS}/11-trip-charts.png` })
  await expect(page.getByTestId("transfer")).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/12-trip-full.png`, fullPage: true })

  await page.getByTestId("tab-overview").click()
  await page.getByTestId("card-engine").click()
  await expect(page.getByTestId("dtc")).toHaveCount(2)
  await expect(page.getByTestId("can-drive").first()).toContainText("Ехать можно")
  await page.getByTestId("scan").click()
  await expect(page.getByTestId("scan-info")).toContainText("Последняя проверка", { timeout: 10_000 })
  await page.screenshot({ path: `${SHOTS}/13-engine.png`, fullPage: true })

  await page.getByTestId("tab-overview").click()
  await page.getByTestId("card-battery").click()
  await expect(page.getByTestId("chart-bat-rest")).toBeVisible()
  await expect(page.getByTestId("chart-bat-crank")).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/14-battery.png`, fullPage: true })

  await page.getByTestId("tab-overview").click()
  await page.getByTestId("open-stats").click()
  await expect(page.locator(".bar")).toHaveCount(10)
  await page.getByTestId("period-month").click()
  await expect(page.locator(".bar")).toHaveCount(6)
  await expect(page.getByTestId("stats-table")).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/15-stats.png`, fullPage: true })
  expect(errors).toEqual([])
})

test("deep links open the right screen", async ({ page }) => {
  const errors = trackErrors(page)
  await openDemo(page)
  for (const [hash, id] of [
    ["#engine", "engine-screen"],
    ["#battery", "battery-screen"],
    ["#stats", "stats-screen"],
    ["#overview", "overview"],
    ["#trip=20261119T100000Z-ab12cd34", "trip-detail"]
  ] as const) {
    await page.goto(`/car/${hash}`)
    await expect(page.getByTestId(id)).toBeVisible()
    await page.reload()
    await expect(page.getByTestId(id)).toBeVisible()
  }
  await expect(page.getByTestId("trip-numbers")).toBeVisible()
  await page.goto("/car/#pair=badcode")
  await expect(page.getByTestId("tab-overview")).toBeVisible()
  expect(errors.filter((e) => !/pair\/complete|404|Failed to load resource/.test(e))).toEqual([])
})

test("unpaired: onboarding is reachable and explains the adapter", async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto("/car/")
  await page.getByTestId("open-onboarding").click()
  await expect(page.getByTestId("ob-title")).toBeVisible()
  await page.getByTestId("ob-need").click()
  await expect(page.getByTestId("ob-warning")).toContainText("Bluetooth")
  await page.screenshot({ path: `${SHOTS}/16-onboarding.png` })
  for (let i = 0; i < 4; i++) await page.getByTestId("ob-next").click()
  await page.getByTestId("ob-done").click()
  await expect(page.getByTestId("pair-screen")).toBeVisible()
  expect(errors).toEqual([])
})

test("dark theme renders overview", async ({ browser }) => {
  const ctx = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 360, height: 780 },
    locale: "ru-RU",
    reducedMotion: "reduce"
  })
  const page = await ctx.newPage()
  await openDemo(page)
  await page.getByTestId("tab-overview").click()
  await expect(page.getByTestId("verdict")).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/17-overview-dark.png`, fullPage: true })
  await ctx.close()
})

for (const scheme of ["light", "dark"] as const) {
  test(`wide desktop viewport renders a centred column (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      reducedMotion: "reduce"
    })
    const page = await ctx.newPage()
    const errors = trackErrors(page)
    await page.goto("/car/")
    await expect(page.getByTestId("pair-screen")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/20-wide-pair-${scheme}.png` })
    await page.getByTestId("pair-demo").click()
    await expect(page.getByTestId("connect-title")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/21-wide-connect-${scheme}.png` })
    await page.getByTestId("tab-overview").click()
    await expect(page.getByTestId("verdict")).toBeVisible()
    const width = await page.getByTestId("overview").evaluate((n) => n.getBoundingClientRect().width)
    expect(width).toBeLessThanOrEqual(600)
    await page.screenshot({ path: `${SHOTS}/22-wide-overview-${scheme}.png` })
    await page.getByTestId("card-trip").click()
    await expect(page.getByTestId("trip-numbers")).toBeVisible()
    const speed = page.getByTestId("chart-speed")
    await speed.scrollIntoViewIfNeeded()
    const box = (await speed.locator("svg").boundingBox())!
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
    await page.screenshot({ path: `${SHOTS}/23-wide-trip-${scheme}.png` })
    await ctx.close()
    expect(errors).toEqual([])
  })
}

test("dark theme: trip charts, engine, recording", async ({ browser }) => {
  const ctx = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 390, height: 844 },
    locale: "ru-RU",
    reducedMotion: "reduce"
  })
  const page = await ctx.newPage()
  await openDemo(page)
  await page.getByTestId("tab-overview").click()
  await page.getByTestId("card-trip").click()
  await expect(page.getByTestId("trip-numbers")).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/24-trip-dark.png`, fullPage: true })
  await page.getByTestId("tab-overview").click()
  await page.getByTestId("card-engine").click()
  await expect(page.getByTestId("dtc")).toHaveCount(2)
  await page.screenshot({ path: `${SHOTS}/25-engine-dark.png`, fullPage: true })
  await page.getByRole("button", { name: "Запись", exact: true }).click()
  await page.getByTestId("primary").click()
  await page.getByTestId("transport-simulator").click()
  await page.getByTestId("connect-go").click()
  await expect(page.locator('[data-step="sensors"]')).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await page.getByTestId("connect-start").click()
  await expect.poll(() => gaugeText(page, "speedKmh"), { timeout: 15_000 }).toMatch(/\d/)
  await page.screenshot({ path: `${SHOTS}/26-recording-dark.png` })
  await ctx.close()
})
