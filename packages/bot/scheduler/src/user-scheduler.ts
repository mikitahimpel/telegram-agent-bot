import { Context, Layer } from "effect"
import type { TgId } from "@bot/core-contracts/ids"
import { Scheduler } from "@bot/core-contracts/scheduler"

export class UserScheduler extends Context.Service<
  UserScheduler,
  { readonly forUser: (tgId: TgId) => Scheduler["Service"] }
>()("@bot/UserScheduler") {}

export const layerLocal = (own: TgId, scheduler: Scheduler["Service"]): Layer.Layer<UserScheduler> =>
  Layer.succeed(UserScheduler, {
    forUser: (tgId) => {
      if (tgId !== own) throw new Error(`scheduler of ${own} asked for ${tgId}`)
      return scheduler
    }
  })
