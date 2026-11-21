import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import type { BotPlugin } from "@bot/core-contracts/plugin"
import { TgId } from "@bot/core-contracts/ids"
import { handleMcpRequest } from "../src/mcp-server.ts"
import { layerMemory, PluginFlags } from "../src/flags.ts"
import { McpToken, layerSecret } from "../src/mcp-token.ts"
import { makePluginRegistry } from "../src/registry.ts"

const fake: BotPlugin = {
  id: "fake",
  title: { en: "Fake", ru: "Фейк" },
  commands: [],
  callbacks: [],
  enabledByDefault: true,
  systemPrompt: "use fake",
  layer: Layer.empty,
  tools: [
    {
      name: "fake_echo",
      description: "echo",
      input: Schema.Struct({ text: Schema.String, n: Schema.optionalKey(Schema.Int) }),
      handler: (input, ctx) => Effect.succeed({ input, tgId: ctx.tgId })
    }
  ]
}
const off: BotPlugin = { ...fake, id: "off", enabledByDefault: false, tools: [{ ...fake.tools[0]!, name: "off_echo" }] }

const registry = makePluginRegistry([fake, off])
const env = Layer.mergeAll(layerSecret("s3cret"), layerMemory([fake, off]))
const tg = TgId.make(42)

const rpc = (token: string, body: unknown) =>
  handleMcpRequest(registry)(
    new Request("http://x/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  )

describe("mcp", () => {
  it.effect("round trip", () =>
    Effect.gen(function* () {
      const token = yield* McpToken.use((t) => t.sign(tg, 60))
      const init = yield* rpc(token, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" }
      })
      const initBody: any = yield* Effect.promise(() => init.json())
      expect(initBody.result.protocolVersion).toBe("2025-06-18")
      expect(initBody.result.capabilities).toEqual({ tools: {} })

      const note = yield* rpc(token, { jsonrpc: "2.0", method: "notifications/initialized" })
      expect(note.status).toBe(202)

      const list = yield* rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/list" })
      const listBody: any = yield* Effect.promise(() => list.json())
      expect(listBody.result.tools.map((t: any) => t.name)).toEqual(["fake_echo"])
      expect(listBody.result.tools[0].inputSchema.type).toBe("object")
      expect(listBody.result.tools[0].inputSchema.properties.text).toBeDefined()

      const call = yield* rpc(token, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "fake_echo", arguments: { text: "hi" } }
      })
      const callBody: any = yield* Effect.promise(() => call.json())
      expect(callBody.result.isError).toBe(false)
      expect(JSON.parse(callBody.result.content[0].text)).toEqual({ input: { text: "hi" }, tgId: 42 })

      const bad = yield* rpc(token, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "fake_echo", arguments: { text: 1 } }
      })
      expect(((yield* Effect.promise(() => bad.json())) as any).result.isError).toBe(true)

      const disabled = yield* rpc(token, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "off_echo", arguments: { text: "x" } }
      })
      expect(((yield* Effect.promise(() => disabled.json())) as any).error.code).toBe(-32602)

      const ping = yield* rpc(token, { jsonrpc: "2.0", id: 6, method: "ping" })
      expect(((yield* Effect.promise(() => ping.json())) as any).result).toEqual({})
    }).pipe(Effect.provide(env))
  )

  it.effect("rejects bad token", () =>
    Effect.gen(function* () {
      const res = yield* rpc("nope", { jsonrpc: "2.0", id: 1, method: "ping" })
      expect(res.status).toBe(401)
      const other = yield* McpToken.use((t) => t.sign(tg, 60)).pipe(Effect.provide(layerSecret("other")))
      expect((yield* rpc(other, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401)
      const expired = yield* McpToken.use((t) => t.sign(tg, -1))
      expect((yield* rpc(expired, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401)
    }).pipe(Effect.provide(env))
  )

  it.effect("flags toggle tools and prompt", () =>
    Effect.gen(function* () {
      const flags = yield* PluginFlags
      yield* flags.setEnabled("off", tg, true)
      yield* flags.setEnabled("fake", tg, false)
      expect((yield* registry.toolsFor(tg)).map((t) => t.name)).toEqual(["off_echo"])
      expect(yield* registry.systemPromptFor(tg)).toBe("use fake")
    }).pipe(Effect.provide(env))
  )

  it.effect("carries the user's language in the token claims", () =>
    Effect.gen(function* () {
      const withLang = yield* McpToken.use((t) => t.sign(tg, 60, "ru"))
      const claims = yield* McpToken.use((t) => t.verifyClaims(withLang))
      expect(claims).toEqual({ tgId: tg, lang: "ru" })
      const plain = yield* McpToken.use((t) => t.sign(tg, 60))
      expect((yield* McpToken.use((t) => t.verifyClaims(plain))).lang).toBeUndefined()
      expect(yield* McpToken.use((t) => t.verify(withLang))).toBe(tg)
    }).pipe(Effect.provide(layerSecret("test-secret")))
  )
})
