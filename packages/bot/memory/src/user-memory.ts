import { Context, Layer } from "effect"
import type { TgId } from "@bot/core-contracts/ids"
import type { MemoryStore } from "./memory-store.ts"

export class UserMemory extends Context.Service<UserMemory, { readonly forUser: (tgId: TgId) => MemoryStore }>()(
  "@bot/UserMemory"
) {}

export const layerLocal = (own: TgId, store: MemoryStore): Layer.Layer<UserMemory> =>
  Layer.succeed(UserMemory, {
    forUser: (tgId) => {
      if (tgId !== own) throw new Error(`memory of ${own} asked for ${tgId}`)
      return store
    }
  })
