import { Context } from "effect"

export interface CarKvLike {
  readonly get: (key: string) => Promise<string | null>
  readonly put: (key: string, value: string, options?: { readonly expirationTtl?: number }) => Promise<void>
  readonly delete: (key: string) => Promise<void>
}

export class CarKv extends Context.Service<CarKv, CarKvLike>()("@bot/plugins-car/CarKv") {}

export const makeMemoryKv = (): CarKvLike & { readonly store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k)
  }
}
