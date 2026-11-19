import { Clock, Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import { Scheduler, type JobHandler, type ScheduledJob } from "@bot/core-contracts/scheduler"

export type SqlLike = {
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly exec: (query: string, ...bindings: Array<any>) => { readonly toArray: () => Array<any> }
}

export type AlarmLike = {
  readonly setAlarm: (at: number) => Promise<void>
  readonly deleteAlarm: () => Promise<void>
}

export const MAX_RETRIES = 3
export const RETRY_BACKOFF_MS: ReadonlyArray<number> = [30_000, 120_000, 600_000]

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS scheduled_jobs_at ON scheduled_jobs (at)`,
  `CREATE INDEX IF NOT EXISTS scheduled_jobs_kind ON scheduled_jobs (kind)`
]

type StoredJob = ScheduledJob & { readonly attempts: number }

const toJob = (row: Record<string, unknown>): StoredJob => ({
  id: String(row["id"]),
  kind: String(row["kind"]),
  at: Number(row["at"]),
  payload: String(row["payload"]),
  attempts: Number(row["attempts"])
})

const publicJob = ({ id, kind, at, payload }: StoredJob): ScheduledJob => ({ id, kind, at, payload })

const attempt = <A>(operation: string, f: () => A) =>
  Effect.try({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

const attemptAsync = (operation: string, f: () => Promise<void>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

export type SchedulerStore = {
  readonly service: Scheduler["Service"]
  readonly runDue: <R>(
    handlers: ReadonlyArray<JobHandler<R>>,
    tgId: TgId
  ) => Effect.Effect<void, StorageError, R>
  readonly rearm: Effect.Effect<void, StorageError>
}

export const makeStore = (sql: SqlLike, alarm: AlarmLike): SchedulerStore => {
  for (const statement of SCHEMA) sql.exec(statement).toArray()

  const rows = (operation: string, query: string, ...bindings: Array<unknown>) =>
    attempt(operation, () => sql.exec(query, ...bindings).toArray().map(toJob))

  const write = (operation: string, query: string, ...bindings: Array<unknown>) =>
    attempt(operation, () => void sql.exec(query, ...bindings).toArray())

  const rearm = Effect.gen(function* () {
    const next = yield* attempt("scheduler.next", () =>
      sql.exec("SELECT MIN(at) AS at FROM scheduled_jobs").toArray()[0]?.["at"] as number | null | undefined
    )
    if (next === null || next === undefined) return yield* attemptAsync("scheduler.clear-alarm", () => alarm.deleteAlarm())
    yield* attemptAsync("scheduler.set-alarm", () => alarm.setAlarm(Number(next)))
  })

  const service: Scheduler["Service"] = {
    schedule: (job) =>
      write(
        "scheduler.schedule",
        `INSERT INTO scheduled_jobs (id, kind, at, payload, attempts) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, at = excluded.at, payload = excluded.payload, attempts = 0`,
        job.id,
        job.kind,
        job.at,
        job.payload
      ).pipe(Effect.andThen(rearm)),
    cancel: (id) => write("scheduler.cancel", "DELETE FROM scheduled_jobs WHERE id = ?", id).pipe(Effect.andThen(rearm)),
    get: (id) =>
      rows("scheduler.get", "SELECT * FROM scheduled_jobs WHERE id = ?", id).pipe(Effect.map((r) => r[0] && publicJob(r[0]))),
    list: (kind) =>
      rows("scheduler.list", "SELECT * FROM scheduled_jobs WHERE kind = ? ORDER BY at, id", kind).pipe(
        Effect.map((r) => r.map(publicJob))
      )
  }

  const settle = (job: StoredJob, outcome: "ok" | "failed", now: number) =>
    Effect.gen(function* () {
      if (outcome === "ok") return yield* write("scheduler.done", "DELETE FROM scheduled_jobs WHERE id = ? AND at = ?", job.id, job.at)
      const attempts = job.attempts + 1
      if (attempts > MAX_RETRIES) {
        yield* Effect.logError(`scheduler dropped job ${job.id} (${job.kind}) after ${MAX_RETRIES} retries`)
        return yield* write("scheduler.drop", "DELETE FROM scheduled_jobs WHERE id = ? AND at = ?", job.id, job.at)
      }
      const delay = RETRY_BACKOFF_MS[attempts - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 60_000
      yield* write(
        "scheduler.retry",
        "UPDATE scheduled_jobs SET at = ?, attempts = ? WHERE id = ? AND at = ?",
        now + delay,
        attempts,
        job.id,
        job.at
      )
    })

  const runDue = <R>(handlers: ReadonlyArray<JobHandler<R>>, tgId: TgId): Effect.Effect<void, StorageError, R> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const due = yield* rows("scheduler.due", "SELECT * FROM scheduled_jobs WHERE at <= ? ORDER BY at, id", now)
      for (const job of due) {
        const handler = handlers.find((h) => h.kind === job.kind)
        if (handler === undefined) {
          yield* Effect.logWarning(`scheduler has no handler for ${job.kind}, dropping ${job.id}`)
          yield* write("scheduler.unknown-kind", "DELETE FROM scheduled_jobs WHERE id = ? AND at = ?", job.id, job.at)
          continue
        }
        const outcome = yield* handler.run(publicJob(job), { tgId, now }).pipe(
          Effect.as("ok" as const),
          Effect.catchCause((cause) =>
            Effect.logWarning(`scheduler job ${job.id} (${job.kind}) failed`, cause).pipe(Effect.as("failed" as const))
          )
        )
        yield* settle(job, outcome, now)
      }
    }).pipe(Effect.ensuring(rearm.pipe(Effect.catch((e) => Effect.logError("scheduler re-arm failed", e)))))

  return { service, runDue, rearm }
}

export const layer = (sql: SqlLike, alarm: AlarmLike): Layer.Layer<Scheduler> =>
  Layer.sync(Scheduler, () => makeStore(sql, alarm).service)
