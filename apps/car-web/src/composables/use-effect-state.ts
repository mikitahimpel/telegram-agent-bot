import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { onScopeDispose, shallowReadonly, shallowRef, type ShallowRef, getCurrentScope } from "vue"

/** Mirrors an Effect SubscriptionRef into a Vue ref. Subscription ends with the current effect scope. */
export const useSubscriptionRef = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Readonly<ShallowRef<A>> => {
  const out = shallowRef<A>(ref.value)
  const fiber = Effect.runFork(
    Stream.runForEach(SubscriptionRef.changes(ref), (v) =>
      Effect.sync(() => {
        out.value = v
      })
    )
  )
  if (getCurrentScope()) onScopeDispose(() => void Effect.runFork(Fiber.interrupt(fiber)))
  return shallowReadonly(out)
}
