import { Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"
import {
  InviteInvalid,
  Invites,
  type Invite,
  type InviteInvalidReason,
  type RedemptionRecord
} from "@bot/core-contracts/invites"

export type SqlLike = {
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly exec: (query: string, ...bindings: Array<any>) => { readonly toArray: () => Array<any> }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL,
    note TEXT,
    plugins TEXT NOT NULL,
    uses_total INTEGER NOT NULL,
    uses_left INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    tg_id INTEGER NOT NULL,
    name TEXT,
    username TEXT,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invite_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS invite_failures_tg ON invite_failures (tg_id, at)`
]

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
const CODE_LENGTH = 24
export const FAILURE_LIMIT = 5
export const FAILURE_WINDOW_MS = 60 * 60 * 1000

export const generateCode = (): string => {
  let out = ""
  while (out.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
    for (const b of bytes) {
      if (b < 248 && out.length < CODE_LENGTH) out += BASE62[b % 62]
    }
  }
  return out
}

const toInvite = (row: Record<string, unknown>): Invite => ({
  code: String(row.code),
  createdBy: TgId.make(Number(row.created_by)),
  note: row.note === null || row.note === undefined ? undefined : String(row.note),
  plugins: JSON.parse(String(row.plugins)) as Array<string>,
  usesTotal: Number(row.uses_total),
  usesLeft: Number(row.uses_left),
  createdAt: Number(row.created_at),
  expiresAt: Number(row.expires_at),
  revoked: Number(row.revoked) !== 0
})

export const makeSqlite = (sql: SqlLike, now: () => number = Date.now): Invites["Service"] => {
  for (const statement of SCHEMA) sql.exec(statement)

  const run = <A>(operation: string, f: () => A) =>
    Effect.try({ try: f, catch: (cause) => new StorageError({ operation, cause }) })
  const rows = (query: string, ...bindings: Array<unknown>) =>
    sql.exec(query, ...bindings).toArray() as Array<Record<string, unknown>>

  const reasonFor = (code: string, at: number): InviteInvalidReason => {
    const row = rows("SELECT * FROM invites WHERE code = ?", code)[0]
    if (row === undefined) return "not_found"
    const invite = toInvite(row)
    if (invite.revoked) return "revoked"
    if (invite.expiresAt <= at) return "expired"
    return "used_up"
  }

  const recentFailures = (tgId: number, at: number) =>
    Number(
      rows("SELECT COUNT(*) AS n FROM invite_failures WHERE tg_id = ? AND at > ?", tgId, at - FAILURE_WINDOW_MS)[0]
        ?.n ?? 0
    )

  return {
    create: (input) =>
      run("invites.create", () => {
        const at = now()
        const code = generateCode()
        sql.exec(
          "INSERT INTO invites (code, created_by, note, plugins, uses_total, uses_left, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
          code,
          input.createdBy,
          input.note ?? null,
          JSON.stringify(input.plugins),
          input.uses,
          input.uses,
          at,
          at + input.ttlMs
        )
        return toInvite(rows("SELECT * FROM invites WHERE code = ?", code)[0]!)
      }),
    list: run("invites.list", () =>
      rows(
        "SELECT * FROM invites WHERE revoked = 0 AND uses_left > 0 AND expires_at > ? ORDER BY created_at DESC",
        now()
      ).map(toInvite)
    ),
    recentRedemptions: (limit) =>
      run("invites.redemptions", () =>
        rows(
          `SELECT r.code AS code, r.tg_id AS tg_id, r.name AS name, r.username AS username, r.at AS at, i.note AS note
           FROM redemptions r LEFT JOIN invites i ON i.code = r.code ORDER BY r.id DESC LIMIT ?`,
          limit
        ).map((row): RedemptionRecord => ({
          code: String(row.code),
          tgId: TgId.make(Number(row.tg_id)),
          name: row.name === null ? undefined : String(row.name),
          username: row.username === null ? undefined : String(row.username),
          note: row.note === null || row.note === undefined ? undefined : String(row.note),
          at: Number(row.at)
        }))
      ),
    revoke: (code) =>
      run(
        "invites.revoke",
        () => rows("UPDATE invites SET revoked = 1 WHERE code = ? AND revoked = 0 RETURNING code", code).length > 0
      ),
    redeem: (code, tgId, who) =>
      Effect.suspend(() => {
        const at = now()
        const outcome = (() => {
          if (recentFailures(tgId, at) >= FAILURE_LIMIT) return { reason: "rate_limited" as const }
          const updated = rows(
            "UPDATE invites SET uses_left = uses_left - 1 WHERE code = ? AND uses_left > 0 AND expires_at > ? AND revoked = 0 RETURNING *",
            code,
            at
          )[0]
          if (updated === undefined) {
            const reason = reasonFor(code, at)
            sql.exec("INSERT INTO invite_failures (tg_id, at) VALUES (?, ?)", tgId, at)
            return { reason }
          }
          sql.exec(
            "INSERT INTO redemptions (code, tg_id, name, username, at) VALUES (?, ?, ?, ?, ?)",
            code,
            tgId,
            who?.name ?? null,
            who?.username ?? null,
            at
          )
          return { invite: toInvite(updated) }
        })()
        if ("reason" in outcome) return Effect.fail(new InviteInvalid({ reason: outcome.reason }))
        const { invite } = outcome
        return Effect.succeed({
          code: invite.code,
          createdBy: invite.createdBy,
          note: invite.note,
          plugins: invite.plugins,
          redeemedAt: at
        })
      }).pipe(Effect.catchDefect((cause) => Effect.fail(new StorageError({ operation: "invites.redeem", cause }))))
  }
}

export const layer = (sql: SqlLike, now?: () => number) => Layer.sync(Invites, () => makeSqlite(sql, now))
