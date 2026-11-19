import { Context, Effect, Layer } from "effect"

export type RememberedAdapter = {
  readonly deviceId: string
  readonly name: string
  readonly rememberedAt: number
}

export class AdapterMemory extends Context.Service<
  AdapterMemory,
  {
    readonly get: Effect.Effect<RememberedAdapter | undefined>
    readonly set: (adapter: RememberedAdapter) => Effect.Effect<void>
    readonly clear: Effect.Effect<void>
  }
>()("@bot/car-recorder/AdapterMemory") {}

const KEY = "car-recorder.adapter"

const isRemembered = (v: unknown): v is RememberedAdapter =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as RememberedAdapter).deviceId === "string" &&
  typeof (v as RememberedAdapter).name === "string" &&
  typeof (v as RememberedAdapter).rememberedAt === "number"

export const adapterMemoryBrowserLayer: Layer.Layer<AdapterMemory> = Layer.succeed(AdapterMemory, {
  get: Effect.sync(() => {
    try {
      const raw = globalThis.localStorage?.getItem(KEY)
      if (raw === null || raw === undefined) return undefined
      const parsed: unknown = JSON.parse(raw)
      return isRemembered(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }),
  set: (adapter) =>
    Effect.sync(() => {
      try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify(adapter))
      } catch {}
    }),
  clear: Effect.sync(() => {
    try {
      globalThis.localStorage?.removeItem(KEY)
    } catch {}
  })
})

export const adapterMemoryFake = (initial?: RememberedAdapter) =>
  Effect.sync(() => {
    const box: { value: RememberedAdapter | undefined } = { value: initial }
    const layer = Layer.succeed(AdapterMemory, {
      get: Effect.sync(() => box.value),
      set: (a) => Effect.sync(() => void (box.value = a)),
      clear: Effect.sync(() => void (box.value = undefined))
    })
    return { layer, box }
  })
