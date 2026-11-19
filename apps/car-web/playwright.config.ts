import { defineConfig } from "@playwright/test"

const PORT = 4173

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: "ru-RU",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
  },
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/car/`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { VITE_BOT_USERNAME: "car_test_bot" }
  }
})
