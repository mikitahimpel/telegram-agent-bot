import { describe, expect, it } from "vite-plus/test"
import { guardQuery } from "../src/guard.ts"
import { buildTrip, cruise, gen, ingestAll, newEngine, T0 } from "./helpers.ts"

describe("guardQuery", () => {
  it("accepts select and with", () => {
    expect(guardQuery("SELECT 1").ok).toBe(true)
    expect(guardQuery("  with a as (select 1 as x) select * from a;  ").ok).toBe(true)
    expect(guardQuery("select 'a;b' as x -- comment ;").ok).toBe(true)
    expect(guardQuery("select replace(trip_id, 'a', 'b') from car_trips").ok).toBe(true)
  })

  it.each([
    "PRAGMA table_info(car_trips)",
    "ATTACH DATABASE 'x' AS y",
    "DELETE FROM car_trips",
    "UPDATE car_trips SET status = 'x'",
    "INSERT INTO car_meta VALUES ('a','b')",
    "DROP TABLE car_trips",
    "select 1; select 2",
    "select 1; delete from car_trips",
    "WITH x AS (SELECT 1) DELETE FROM car_trips",
    "select * from sqlite_master",
    "select load_extension('x')",
    "/* hi */ pragma x",
    "explain select 1",
    "select \"insert\" from car_trips; --",
    "select 'unterminated"
  ])("rejects %s", (q) => {
    const r = guardQuery(q, [])
    if (q === 'select "insert" from car_trips; --') expect(r.ok).toBe(false)
    else expect(r.ok).toBe(false)
  })

  it("rejects non car tables", () => {
    expect(guardQuery("select * from sessions", ["sessions"]).ok).toBe(false)
    expect(guardQuery('select * from "Invites"', ["invites"]).ok).toBe(false)
  })
})

describe("engine.query", () => {
  it("runs reads, hides foreign tables, caps rows and never writes", async () => {
    const { sql, engine } = newEngine()
    sql.run("CREATE TABLE invites (code TEXT)")
    sql.run("INSERT INTO invites VALUES ('secret')")
    ingestAll(engine, await buildTrip(T0, gen(T0, 1200, cruise(50))))
    const rows = engine.query("SELECT COUNT(*) AS c FROM car_samples")
    expect(rows).toMatchObject({ ok: true, columns: ["c"], rows: [[1200]], truncated: false })
    const capped = engine.query("SELECT ts FROM car_samples ORDER BY ts")
    expect(capped.ok && capped.rows.length).toBe(1000)
    expect(capped.ok && capped.truncated).toBe(true)
    expect(engine.query("SELECT * FROM invites").ok).toBe(false)
    expect(engine.query("DELETE FROM car_samples").ok).toBe(false)
    expect(engine.query("SELECT COUNT(*) AS c FROM car_samples")).toMatchObject({ rows: [[1200]] })
    expect(engine.query("SELECT nope FROM car_trips")).toMatchObject({ ok: false })
  })
})
