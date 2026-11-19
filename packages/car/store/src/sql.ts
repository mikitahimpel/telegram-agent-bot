export type SqlValue = string | number | null

export type SqlRow = Record<string, SqlValue>

export type CarSql = {
  readonly run: (sql: string, params?: ReadonlyArray<SqlValue>) => void
  readonly all: (sql: string, params?: ReadonlyArray<SqlValue>) => ReadonlyArray<SqlRow>
  readonly transaction: <A>(f: () => A) => A
}

export const num = (v: SqlValue | undefined): number | undefined => (typeof v === "number" ? v : undefined)

export const numOrNull = (v: SqlValue | undefined): number | null => (typeof v === "number" ? v : null)

export const str = (v: SqlValue | undefined): string =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)
