import { makeCarRuntime } from "@bot/car-recorder/runtime"
import { createDemoBackend } from "./demo-backend.ts"
import type { CarBackend } from "./backend.ts"
import { detectPlatform, localCapabilities } from "./env.ts"
import { withRealBackend } from "./real-backend.ts"

export const API_BASE = "/car/api"

/** One ManagedRuntime (store, API client, recorder, sync) plus the OBD session, wrapped as the UI's CarBackend. */
export const createBackend = (): CarBackend => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  const base = createDemoBackend({ platform: detectPlatform(ua), caps: localCapabilities(), trips: [], diag: [], pairing: "unpaired", storage: null })
  const runtime = makeCarRuntime({ apiBase: API_BASE })
  return withRealBackend(base, runtime, typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev")
}
