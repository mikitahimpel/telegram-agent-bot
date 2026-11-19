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
  await expect(page.getByTestId("trip-distance")).toContainText("км")
  const recorded = await page.locator('[data-testid="counters"] .counter b').first().innerText()
  expect(Number(recorded.replace(/\D/g, ""))).toBeGreaterThan(0)
  await expect(page.getByTestId("status-card").first()).toContainText("Ждёт подключения телефона к аккаунту")
  const grid = page.locator(".chunk-grid, [data-testid='chunk-grid']").first()
  await grid.scrollIntoViewIfNeeded()
  await expect(grid).toBeVisible()
  await expect(page.getByTestId("primary")).toHaveCount(0)
  const box = (await grid.boundingBox())!
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("nav.tabs, .primary-bar") !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
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
      for (const k of ["bluetooth", "serial"]) Object.defineProperty(Navigator.prototype, k, { value: undefined, configurable: true })
    })
    await page.goto("/car/")
    await expect(page.getByTestId("open-in-chrome")).toBeVisible()
    await expect(page.getByRole("button", { name: "Открыть в Chrome" })).toHaveCount(1)
    await page.screenshot({ path: `${SHOTS}/08-webview.png` })
    expect(errors).toEqual([])
  })
})
