import { Context, Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { CarEngine } from "./engine.ts"

export const ENGINE_OPS = [
  "ingestManifest",
  "ingestChunk",
  "putDtc",
  "overview",
  "tripInsight",
  "tripSeries",
  "alerts",
  "dtcCurrent",
  "query",
  "pending",
  "markNotified",
  "weekly",
  "counts",
  "knownChunks",
  "getMeta",
  "setMeta"
] as const satisfies ReadonlyArray<keyof CarEngine>

export type EngineOp = (typeof ENGINE_OPS)[number]

export type CarBackendShape = {
  readonly [K in EngineOp]: (tgId: number, ...args: Parameters<CarEngine[K]>) => Effect.Effect<ReturnType<CarEngine[K]>, StorageError>
}

export class CarBackend extends Context.Service<CarBackend, CarBackendShape>()("@bot/car-store/CarBackend") {}

export type Invoke = (tgId: number, op: EngineOp, args: ReadonlyArray<unknown>) => Promise<unknown>

export const isEngineOp = (op: string): op is EngineOp => (ENGINE_OPS as ReadonlyArray<string>).includes(op)

export const runEngineOp = (engine: CarEngine, op: string, args: ReadonlyArray<unknown>): unknown => {
  if (!isEngineOp(op)) throw new Error(`unknown car op ${op}`)
  const fn = engine[op] as (...a: ReadonlyArray<unknown>) => unknown
  return fn(...args)
}

export const backendFromInvoke = (invoke: Invoke): CarBackendShape => {
  const out: Record<string, unknown> = {}
  for (const op of ENGINE_OPS) {
    out[op] = (tgId: number, ...args: ReadonlyArray<unknown>) =>
      Effect.tryPromise({ try: () => invoke(tgId, op, args), catch: (cause) => new StorageError({ operation: `car.${op}`, cause }) })
  }
  return out as CarBackendShape
}

export const layerInvoke = (invoke: Invoke): Layer.Layer<CarBackend> => Layer.succeed(CarBackend, backendFromInvoke(invoke))

export const layerEngine = (engine: CarEngine): Layer.Layer<CarBackend> =>
  layerInvoke(async (_tgId, op, args) => runEngineOp(engine, op, args))
