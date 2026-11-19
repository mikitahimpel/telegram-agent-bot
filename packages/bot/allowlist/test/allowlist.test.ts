import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"
import { layer, layerMemory, makeMemoryKv, type KvLike } from "../src/allowlist.ts"

const admin = TgId.make(1)
const alice = TgId.make(2)
const bob = TgId.make(3)

describe("Allowlist (memory)", () => {
  it.effect("admin, unknown, allow, revoke", () =>
    Effect.gen(function* () {
      const a = yield* Allowlist
      expect(yield* a.roleOf(admin)).toBe("admin")
      expect(yield* a.roleOf(alice)).toBeUndefined()
      yield* a.allow(alice, admin)
      expect(yield* a.roleOf(alice)).toBe("user")
      const list = yield* a.list
      expect(list.map((e) => [e.tgId, e.addedBy])).toEqual([[alice, admin]])
      yield* a.revoke(alice)
      expect(yield* a.roleOf(alice)).toBeUndefined()
      expect(yield* a.list).toEqual([])
    }).pipe(Effect.provide(layerMemory(admin)))
  )

  it.effect("initial entries", () =>
    Effect.gen(function* () {
      const a = yield* Allowlist
      expect(yield* a.roleOf(bob)).toBe("user")
    }).pipe(Effect.provide(layerMemory(admin, [{ tgId: bob, addedAt: 1, addedBy: admin }])))
  )
})

describe("Allowlist (KV layer)", () => {
  const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({ ADMIN_TG_ID: "1" }))

  it.effect("reads admin from config and stores JSON under allow:<id>", () => {
    const kv = makeMemoryKv()
    return Effect.gen(function* () {
      const a = yield* Allowlist
      expect(a.adminId).toBe(admin)
      yield* a.allow(alice, admin)
      const raw = JSON.parse((yield* Effect.promise(() => kv.get("allow:2"))) ?? "null")
      expect(raw.addedBy).toBe(1)
      expect(typeof raw.addedAt).toBe("number")
    }).pipe(Effect.provide(layer(kv).pipe(Layer.provide(configLayer))))
  })

  it.effect("KV failures become StorageError", () => {
    const broken: KvLike = {
      ...makeMemoryKv(),
      get: () => Promise.reject(new Error("boom"))
    }
    return Effect.gen(function* () {
      const a = yield* Allowlist
      const err = yield* Effect.flip(a.roleOf(alice))
      expect(err).toBeInstanceOf(StorageError)
    }).pipe(Effect.provide(layer(broken).pipe(Layer.provide(configLayer))))
  })
})
