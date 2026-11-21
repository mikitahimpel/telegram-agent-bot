import { Clock, Config, Context, Data, Effect, Layer, Redacted, Schema } from "effect"
import { TgId } from "@bot/core-contracts/ids"
import { type Lang, Lang as LangSchema } from "@bot/core-contracts/lang"

export class InvalidMcpToken extends Data.TaggedError("InvalidMcpToken")<{
  readonly reason: "malformed" | "signature" | "expired"
}> {}

const Payload = Schema.Struct({ tgId: TgId, exp: Schema.Number, lang: Schema.optional(LangSchema) })

export type McpClaims = { readonly tgId: TgId; readonly lang: Lang | undefined }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

const fromBase64Url = (text: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=")
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  } catch {
    return undefined
  }
}

export class McpToken extends Context.Service<
  McpToken,
  {
    readonly sign: (tgId: TgId, ttlSeconds: number, lang?: Lang) => Effect.Effect<string>
    readonly verify: (token: string) => Effect.Effect<TgId, InvalidMcpToken>
    readonly verifyClaims: (token: string) => Effect.Effect<McpClaims, InvalidMcpToken>
  }
>()("@bot/McpToken") {}

const make = (secret: string): McpToken["Service"] => {
  const keyPromise = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ])

  const sign = (tgId: TgId, ttlSeconds: number, lang?: Lang) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const payload = toBase64Url(
        encoder.encode(
          JSON.stringify({ tgId, exp: Math.floor(now / 1000) + ttlSeconds, ...(lang === undefined ? {} : { lang }) })
        )
      )
      const key = yield* Effect.promise(() => keyPromise)
      const sig = yield* Effect.promise(() => crypto.subtle.sign("HMAC", key, encoder.encode(payload)))
      return `${payload}.${toBase64Url(new Uint8Array(sig))}`
    })

  const verifyClaims = (token: string): Effect.Effect<McpClaims, InvalidMcpToken> =>
    Effect.gen(function* () {
      const parts = token.split(".")
      const [payloadText, sigText] = parts
      if (parts.length !== 2 || payloadText === undefined || sigText === undefined) {
        return yield* new InvalidMcpToken({ reason: "malformed" })
      }
      const sig = fromBase64Url(sigText)
      const payloadBytes = fromBase64Url(payloadText)
      if (sig === undefined || payloadBytes === undefined) return yield* new InvalidMcpToken({ reason: "malformed" })
      const key = yield* Effect.promise(() => keyPromise)
      const ok = yield* Effect.promise(() =>
        crypto.subtle.verify("HMAC", key, sig as BufferSource, encoder.encode(payloadText))
      )
      if (!ok) return yield* new InvalidMcpToken({ reason: "signature" })
      const payload = yield* Effect.try({
        try: () => JSON.parse(decoder.decode(payloadBytes)) as unknown,
        catch: () => new InvalidMcpToken({ reason: "malformed" })
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Payload)),
        Effect.mapError(() => new InvalidMcpToken({ reason: "malformed" }))
      )
      const now = yield* Clock.currentTimeMillis
      if (payload.exp * 1000 <= now) return yield* new InvalidMcpToken({ reason: "expired" })
      return { tgId: payload.tgId, lang: payload.lang }
    })

  const verify = (token: string) => verifyClaims(token).pipe(Effect.map((c) => c.tgId))

  return { sign, verify, verifyClaims }
}

export const layerSecret = (secret: string): Layer.Layer<McpToken> => Layer.succeed(McpToken, make(secret))

export const layer = Layer.effect(
  McpToken,
  Effect.gen(function* () {
    const secret = yield* Config.Redacted("MCP_TOKEN_SECRET")
    return make(Redacted.value(secret))
  })
)
