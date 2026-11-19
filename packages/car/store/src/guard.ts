import type { CarSql, SqlValue } from "./sql.ts"

export const MAX_ROWS = 1000
const MAX_CELL_CHARS = 2000
const MAX_QUERY_CHARS = 8000

const FORBIDDEN_WORDS = new Set([
  "pragma",
  "attach",
  "detach",
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "vacuum",
  "reindex",
  "analyze",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "release",
  "load_extension",
  "readfile",
  "writefile",
  "edit",
  "fts3_tokenizer",
  "zeroblob",
  "randomblob"
])

export type GuardResult =
  | { readonly ok: true; readonly sql: string }
  | { readonly ok: false; readonly reason: string }

type Scan = { readonly clean: string; readonly words: ReadonlyArray<string>; readonly semicolons: ReadonlyArray<number>; readonly error: string | undefined }

const scan = (query: string): Scan => {
  let clean = ""
  const words: Array<string> = []
  const semicolons: Array<number> = []
  let i = 0
  const n = query.length
  const quoted = (open: string, close: string, collect: boolean): string | undefined => {
    let j = i + 1
    let body = ""
    while (j < n) {
      const ch = query[j] as string
      if (ch === close) {
        if (query[j + 1] === close && open === close) {
          body += close
          j += 2
          continue
        }
        break
      }
      body += ch
      j++
    }
    if (j >= n) return "unterminated quote"
    if (collect) words.push(body.toLowerCase())
    clean += query.slice(i, j + 1)
    i = j + 1
    return undefined
  }
  while (i < n) {
    const c = query[i] as string
    if (c === "-" && query[i + 1] === "-") {
      while (i < n && query[i] !== "\n") i++
      clean += " "
    } else if (c === "/" && query[i + 1] === "*") {
      const end = query.indexOf("*/", i + 2)
      if (end < 0) return { clean, words, semicolons, error: "unterminated comment" }
      i = end + 2
      clean += " "
    } else if (c === "'") {
      const err = quoted("'", "'", false)
      if (err !== undefined) return { clean, words, semicolons, error: err }
    } else if (c === '"' || c === "`") {
      const err = quoted(c, c, true)
      if (err !== undefined) return { clean, words, semicolons, error: err }
    } else if (c === "[") {
      const err = quoted("[", "]", true)
      if (err !== undefined) return { clean, words, semicolons, error: err }
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(query[j] as string)) j++
      words.push(query.slice(i, j).toLowerCase())
      clean += query.slice(i, j)
      i = j
    } else {
      if (c === ";") semicolons.push(clean.length)
      clean += c
      i++
    }
  }
  return { clean, words, semicolons, error: undefined }
}

export const guardQuery = (query: string, forbiddenTables: ReadonlyArray<string> = []): GuardResult => {
  if (query.length > MAX_QUERY_CHARS) return { ok: false, reason: "query is too long" }
  const s = scan(query)
  if (s.error !== undefined) return { ok: false, reason: s.error }
  const text = s.clean.trim()
  const trailing = text.endsWith(";") ? text.length - 1 + (s.clean.length - s.clean.trimStart().length) : -1
  if (s.semicolons.some((pos) => pos !== trailing)) return { ok: false, reason: "only a single statement is allowed" }
  const stripped = text.replace(/;\s*$/, "")
  const first = s.words[0]
  if (first !== "select" && first !== "with") return { ok: false, reason: "only SELECT or WITH queries are allowed" }
  if (!/^\s*(select|with)\b/i.test(stripped)) return { ok: false, reason: "only SELECT or WITH queries are allowed" }
  const denied = new Set(forbiddenTables.map((t) => t.toLowerCase()))
  for (const w of s.words) {
    if (FORBIDDEN_WORDS.has(w)) return { ok: false, reason: `"${w}" is not allowed: queries are read-only` }
    if (w.startsWith("sqlite_")) return { ok: false, reason: "system tables are not accessible" }
    if (denied.has(w)) return { ok: false, reason: `table "${w}" is not accessible, use the car_* tables` }
  }
  return { ok: true, sql: stripped }
}

export type QueryResult =
  | { readonly ok: true; readonly columns: ReadonlyArray<string>; readonly rows: ReadonlyArray<ReadonlyArray<SqlValue>>; readonly truncated: boolean }
  | { readonly ok: false; readonly error: string }

export const runGuarded = (sql: CarSql, query: string): QueryResult => {
  const tables = sql
    .all(`SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'car\\_%' ESCAPE '\\'`)
    .map((r) => String(r["name"]))
  const guarded = guardQuery(query, tables)
  if (!guarded.ok) return { ok: false, error: guarded.reason }
  try {
    const rows = sql.all(`SELECT * FROM (\n${guarded.sql}\n) LIMIT ${MAX_ROWS + 1}`)
    const truncated = rows.length > MAX_ROWS
    const kept = rows.slice(0, MAX_ROWS)
    const columns = kept[0] === undefined ? [] : Object.keys(kept[0])
    return {
      ok: true,
      columns,
      rows: kept.map((r) => columns.map((c) => cap(r[c] ?? null))),
      truncated
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "query failed" }
  }
}

const cap = (v: SqlValue): SqlValue => (typeof v === "string" && v.length > MAX_CELL_CHARS ? v.slice(0, MAX_CELL_CHARS) : v)
