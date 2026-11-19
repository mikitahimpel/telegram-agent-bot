import { makeMemoryStore, type MemoryStore } from "@bot/bot-memory/memory-store"

const stores = new WeakMap<object, MemoryStore>()

export const userMemoryStore = (ctx: DurableObjectState): MemoryStore => {
  let store = stores.get(ctx)
  if (store === undefined) {
    store = makeMemoryStore(ctx.storage.sql)
    stores.set(ctx, store)
  }
  return store
}
