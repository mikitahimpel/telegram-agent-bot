import { defineConfig } from "vite-plus"

export default defineConfig({ test: { setupFiles: ["./test/setup.ts"], testTimeout: 60_000, retry: 3 } })
