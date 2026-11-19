import { Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import type { ScheduledJob } from "@bot/core-contracts/scheduler"
import { UserScheduler } from "@bot/bot-scheduler/user-scheduler"
import type { Env } from "./env.ts"

const call = <A>(operation: string, f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

export const rpcUserScheduler = (env: Env): Layer.Layer<UserScheduler> =>
  Layer.succeed(UserScheduler, {
    forUser: (tgId: TgId) => {
      const stub = () => env.USER_AGENT.getByName(String(tgId))
      return {
        schedule: (job: ScheduledJob) => call("scheduler.rpc.schedule", () => stub().scheduleJob(tgId, job)),
        cancel: (id: string) => call("scheduler.rpc.cancel", () => stub().cancelJob(tgId, id)),
        get: (id: string) => call("scheduler.rpc.get", () => stub().getJob(tgId, id)),
        list: (kind: string) => call("scheduler.rpc.list", () => stub().listJobs(tgId, kind))
      }
    }
  })
