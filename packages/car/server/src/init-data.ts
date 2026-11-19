const encoder = new TextEncoder()

export interface InitDataUser {
  readonly tgId: number
  readonly firstName: string
  readonly languageCode: string | undefined
}

export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60

const hmacKey = (key: ArrayBuffer | Uint8Array, usages: ReadonlyArray<KeyUsage>) =>
  crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, [...usages])

const fromHex = (hex: string): Uint8Array | undefined => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return undefined
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Telegram Mini App `initData` validation (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key = "WebAppData", message = bot token);
 * hash = HMAC_SHA256(key = secret, message = sorted "key=value" lines without `hash`, joined by "\n").
 * The comparison is constant-time (WebCrypto `verify`). `auth_date` must be at most 24 h old.
 */
export const validateInitData = async (
  initData: string,
  botToken: string,
  nowMs: number
): Promise<InitDataUser | undefined> => {
  const params = new URLSearchParams(initData)
  const hash = params.get("hash")
  if (hash === null) return undefined
  const expected = fromHex(hash)
  if (expected === undefined) return undefined
  const lines: Array<string> = []
  for (const [k, v] of params) if (k !== "hash") lines.push(`${k}=${v}`)
  lines.sort()
  const secret = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode("WebAppData"), ["sign"]), encoder.encode(botToken))
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, ["verify"]),
    expected as BufferSource,
    encoder.encode(lines.join("\n"))
  )
  if (!ok) return undefined
  const authDate = Number(params.get("auth_date"))
  if (!Number.isFinite(authDate) || authDate <= 0) return undefined
  const age = nowMs / 1000 - authDate
  if (age > INIT_DATA_MAX_AGE_SECONDS || age < -300) return undefined
  try {
    const user = JSON.parse(params.get("user") ?? "") as { id?: unknown; first_name?: unknown; language_code?: unknown }
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id)) return undefined
    return {
      tgId: user.id,
      firstName: typeof user.first_name === "string" ? user.first_name : "",
      languageCode: typeof user.language_code === "string" ? user.language_code : undefined
    }
  } catch {
    return undefined
  }
}

/** Builds a valid initData string (used by tests and local tooling). */
export const signInitData = async (
  fields: Readonly<Record<string, string>>,
  botToken: string
): Promise<string> => {
  const lines = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort()
  const secret = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode("WebAppData"), ["sign"]), encoder.encode(botToken))
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(lines.join("\n")))
  const hash = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")
  return new URLSearchParams({ ...fields, hash }).toString()
}
