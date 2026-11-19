import vue from "@vitejs/plugin-vue"
import { defineConfig, lazyPlugins } from "vite-plus"

export default defineConfig({
  base: "/car/",
  plugins: lazyPlugins(() => [vue()]),
  define: { __APP_VERSION__: JSON.stringify("0.1.0") },
  build: { outDir: "dist", target: "es2022", sourcemap: false },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"] }
})
