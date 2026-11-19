import { Layer } from "effect"
import { CarBackend, layerEngine, layerInvoke, runEngineOp } from "@bot/car-store/backend"
import { makeEngine, type CarEngine } from "@bot/car-store/engine"
import type { CarSql, SqlRow, SqlValue } from "@bot/car-store/sql"
import type { Env } from "./env.ts"

const engines = new WeakMap<object, CarEngine>()

export const carSql = (ctx: DurableObjectState): CarSql => ({
  run: (sql, params = []) => {
    ctx.storage.sql.exec(sql, ...params)
  },
  all: (sql, params = []) => ctx.storage.sql.exec(sql, ...params).toArray() as Array<SqlRow>,
  transaction: <A>(f: () => A): A => ctx.storage.transactionSync(f)
})

export const carEngine = (ctx: DurableObjectState): CarEngine => {
  let engine = engines.get(ctx)
  if (engine === undefined) {
    engine = makeEngine(carSql(ctx))
    engines.set(ctx, engine)
  }
  return engine
}

export const runCarOp = (ctx: DurableObjectState, op: string, args: ReadonlyArray<unknown>): unknown =>
  runEngineOp(carEngine(ctx), op, args)

export const rpcCarBackend = (env: Env): Layer.Layer<CarBackend> =>
  layerInvoke((tgId, op, args) => env.USER_AGENT.getByName(String(tgId)).car(tgId, op, [...args]))

export const localCarBackend = (ctx: DurableObjectState): Layer.Layer<CarBackend> => layerEngine(carEngine(ctx))

export type { SqlValue }
