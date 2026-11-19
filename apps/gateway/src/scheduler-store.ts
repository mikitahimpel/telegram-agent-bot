import { makeStore, type SchedulerStore } from "@bot/bot-scheduler/scheduler"

const stores = new WeakMap<object, SchedulerStore>()

export const userStore = (ctx: DurableObjectState): SchedulerStore => {
  let store = stores.get(ctx)
  if (store === undefined) {
    store = makeStore(ctx.storage.sql, {
      setAlarm: (at) => ctx.storage.setAlarm(at),
      deleteAlarm: () => ctx.storage.deleteAlarm()
    })
    stores.set(ctx, store)
  }
  return store
}
