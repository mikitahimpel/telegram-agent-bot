import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
  base: "/car/",
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify("0.1.0") },
  build: { outDir: "dist", target: "es2022", sourcemap: true },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"] }
})
