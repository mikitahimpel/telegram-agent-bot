import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TgId } from "@bot/core-contracts/ids"
import type { BotPlugin } from "@bot/core-contracts/plugin"
import { callbackData, layerKv, PluginFlags } from "../src/flags.ts"
import type { KvLike } from "../src/flags.ts"
import { makePluginRegistry } from "../src/registry.ts"

const p: BotPlugin = {
  id: "car",
  title: { en: "Car", ru: "Авто" },
  commands: [],
  callbacks: [],
  tools: [],
  layer: Layer.empty,
  enabledByDefault: true
}

const memKv = (): KvLike & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k)
  }
}

describe("flags", () => {
  it.effect("kv default and override", () =>
    Effect.gen(function* () {
      const kv = memKv()
      const tg = TgId.make(7)
      yield* Effect.gen(function* () {
        const f = yield* PluginFlags
        expect(yield* f.isEnabled("car", tg)).toBe(true)
        expect(yield* f.isEnabled("nope", tg)).toBe(false)
        yield* f.setEnabled("car", tg, false)
        expect(yield* f.isEnabled("car", tg)).toBe(false)
      }).pipe(Effect.provide(layerKv(kv, [p])))
      expect(JSON.parse(kv.data.get("plugins:7")!)).toEqual({ car: false })
    })
  )

  it("callback data shape and admin commands", () => {
    expect(callbackData(TgId.make(7), "car", true)).toBe("plg:7:car:1")
    const reg = makePluginRegistry([p])
    expect(reg.commands.map((c) => c.name)).toContain("plugins")
    expect(reg.commands.find((c) => c.name === "plugins")?.role).toBe("admin")
    expect(reg.callbacks[0]?.prefix).toBe("plg")
  })
})
