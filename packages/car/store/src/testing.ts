/// <reference types="node" />
import { DatabaseSync } from "node:sqlite"
import type { CarSql, SqlValue } from "./sql.ts"

export const makeNodeSql = (): CarSql => {
  const db = new DatabaseSync(":memory:")
  let depth = 0
  return {
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as Array<SqlValue>))
    },
    all: (sql, params = []) => db.prepare(sql).all(...(params as Array<SqlValue>)) as Array<Record<string, SqlValue>>,
    transaction: (f) => {
      if (depth > 0) return f()
      depth++
      db.exec("BEGIN")
      try {
        const out = f()
        db.exec("COMMIT")
        return out
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      } finally {
        depth--
      }
    }
  }
}
