import type { PairError } from "../model/types.ts"
import { Effect } from "effect"
import { clearCredentials, loadCredentials, saveCredentials, type DeviceCredentials } from "@bot/car-recorder/credentials"

export type Credential = DeviceCredentials

export const parsePairHash = (hash: string): string | null => {
  const m = /(?:^#|&)pair=([A-Za-z0-9_-]+)/.exec(hash)
  return m?.[1] ?? null
}

/** "Chrome · Pixel 8" style name from the user agent. */
export const deviceNameFromUA = (ua: string): string => {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser"
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|[;)])/.exec(ua)?.[1]?.trim()
  const model = android && android !== "K" ? android : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "device"
  return `${browser} · ${model}`
}

export type PairResult = { ok: true; credential: Credential } | { ok: false; error: PairError }

export const completePair = async (
  apiBase: string,
  code: string,
  deviceName: string,
  fetchFn: typeof fetch = fetch
): Promise<PairResult> => {
  let res: Response
  try {
    res = await fetchFn(`${apiBase}/pair/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName })
    })
  } catch {
    return { ok: false, error: "network" }
  }
  if (res.ok) {
    const body = (await res.json()) as Credential
    return { ok: true, credential: { deviceToken: body.deviceToken, deviceId: body.deviceId, tgId: body.tgId, firstName: body.firstName } }
  }
  let code2 = ""
  try {
    code2 = ((await res.json()) as { error?: { code?: string } }).error?.code ?? ""
  } catch {
    /* non-JSON error body */
  }
  if (code2 === "pair_code_invalid") return { ok: false, error: "invalid" }
  if (code2 === "plugin_disabled" || code2 === "forbidden") return { ok: false, error: "blocked" }
  if (res.status >= 500 || res.status === 429) return { ok: false, error: "network" }
  return { ok: false, error: "unknown" }
}

export const credentialStore = {
  load: async (): Promise<Credential | null> => (await Effect.runPromise(loadCredentials().pipe(Effect.orElseSucceed(() => undefined)))) ?? null,
  save: (c: Credential): Promise<void> => Effect.runPromise(saveCredentials(c).pipe(Effect.orElseSucceed(() => undefined))),
  clear: (): Promise<void> => Effect.runPromise(clearCredentials().pipe(Effect.orElseSucceed(() => undefined)))
}
