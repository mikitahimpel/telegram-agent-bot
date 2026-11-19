import type { PairError } from "../model/types.ts"

export interface Credential {
  deviceToken: string
  tgId: number
  firstName: string
}

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
    return { ok: true, credential: { deviceToken: body.deviceToken, tgId: body.tgId, firstName: body.firstName } }
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

export const startPair = async (apiBase: string, initData: string, fetchFn: typeof fetch = fetch): Promise<string | null> => {
  try {
    const res = await fetchFn(`${apiBase}/pair/start`, { method: "POST", headers: { authorization: `tma ${initData}` } })
    if (!res.ok) return null
    return ((await res.json()) as { url: string }).url
  } catch {
    return null
  }
}

/** Tiny IndexedDB key-value store for the device credential (replace with @bot/car-recorder `./credentials`). */
const DB = "car-web"
const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore("kv")
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

export const credentialStore = {
  async load(): Promise<Credential | null> {
    try {
      const db = await openDb()
      return await new Promise((resolve) => {
        const r = db.transaction("kv").objectStore("kv").get("credential")
        r.onsuccess = () => resolve((r.result as Credential | undefined) ?? null)
        r.onerror = () => resolve(null)
      })
    } catch {
      return null
    }
  },
  async save(c: Credential): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite")
      tx.objectStore("kv").put(c, "credential")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
