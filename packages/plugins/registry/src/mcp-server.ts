import { Effect, Schema } from "effect"
import type { TgId } from "@bot/core-contracts/ids"
import type { AgentTool } from "@bot/core-contracts/plugin"
import type { PluginFlags } from "./flags.ts"
import { McpToken } from "./mcp-token.ts"
import type { PluginRegistry } from "./registry.ts"

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const
const LATEST = SUPPORTED_PROTOCOL_VERSIONS[0]

type Id = string | number | null

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result })
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } })

const inputSchemaOf = (tool: AgentTool<any>): Record<string, unknown> => {
  const doc = Schema.toJsonSchemaDocument(tool.input)
  const schema: Record<string, unknown> = { type: "object", ...(doc.schema as Record<string, unknown>) }
  if (Object.keys(doc.definitions).length > 0) schema["$defs"] = doc.definitions
  return schema
}

const errorText = (e: unknown): string => {
  if (typeof e === "object" && e !== null) {
    const tag = "_tag" in e ? String((e as { _tag: unknown })._tag) : "Error"
    const cause = "cause" in e ? (e as { cause: unknown }).cause : undefined
    const causeMsg = typeof cause === "object" && cause !== null && "message" in cause ? String((cause as { message: unknown }).message) : undefined
    const op = "operation" in e ? String((e as { operation: unknown }).operation) : undefined
    return [tag, op, causeMsg].filter((s) => s !== undefined).join(": ")
  }
  return String(e)
}

const toolResult = (text: string, isError: boolean) => ({ content: [{ type: "text", text }], isError })

const callTool = <R>(tools: ReadonlyArray<AgentTool<R>>, tgId: TgId, params: unknown) =>
  Effect.gen(function*() {
    const p = (typeof params === "object" && params !== null ? params : {}) as { name?: unknown; arguments?: unknown }
    const tool = tools.find((t) => t.name === p.name)
    if (tool === undefined) return undefined
    const decoded = yield* Schema.decodeUnknownEffect(tool.input)(p.arguments ?? {}).pipe(Effect.result)
    if (decoded._tag === "Failure") return toolResult(`Invalid arguments: ${String(decoded.failure.message)}`, true)
    return yield* tool.handler(decoded.success, { tgId }).pipe(
      Effect.map((value) => toolResult(JSON.stringify(value === undefined ? null : value), false)),
      Effect.catch((e) => Effect.succeed(toolResult(errorText(e), true)))
    )
  }).pipe(Effect.catchCause(() => Effect.succeed(toolResult("Internal tool error", true))))

const handleMessage = <R>(registry: PluginRegistry<R>, tgId: TgId, msg: unknown) =>
  Effect.gen(function*() {
    if (typeof msg !== "object" || msg === null || (msg as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
      return rpcError(null, -32600, "Invalid Request")
    }
    const m = msg as { id?: Id; method?: unknown; params?: unknown }
    if (m.id === undefined) return undefined
    const id = m.id
    switch (m.method) {
      case "initialize": {
        const requested = (m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
        const version = SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ?? LATEST
        return rpcResult(id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "telegram-agent-bot", version: "1.0.0" }
        })
      }
      case "ping":
        return rpcResult(id, {})
      case "tools/list": {
        const tools = yield* registry.toolsFor(tgId)
        return rpcResult(id, {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchemaOf(t) }))
        })
      }
      case "tools/call": {
        const tools = yield* registry.toolsFor(tgId)
        const result = yield* callTool(tools, tgId, m.params)
        return result === undefined ? rpcError(id, -32602, "Unknown tool") : rpcResult(id, result)
      }
      default:
        return rpcError(id, -32601, "Method not found")
    }
  }).pipe(Effect.catch(() => Effect.succeed(rpcError(null, -32603, "Internal error"))))

export const handleMcpRequest =
  <R>(registry: PluginRegistry<R>) =>
  (request: Request): Effect.Effect<Response, never, R | McpToken | PluginFlags> =>
    Effect.gen(function*() {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } })
      const auth = request.headers.get("authorization") ?? ""
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : ""
      const tokens = yield* McpToken
      const verified = yield* tokens.verify(token).pipe(Effect.result)
      if (verified._tag === "Failure") {
        return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" })
      }
      const tgId = verified.success
      const body = yield* Effect.promise(() => request.text())
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return json(rpcError(null, -32700, "Parse error"), 400)
      }
      if (Array.isArray(parsed)) {
        const out = []
        for (const item of parsed) {
          const r = yield* handleMessage(registry, tgId, item)
          if (r !== undefined) out.push(r)
        }
        return out.length === 0 ? new Response(null, { status: 202 }) : json(out)
      }
      const response = yield* handleMessage(registry, tgId, parsed)
      return response === undefined ? new Response(null, { status: 202 }) : json(response)
    })
