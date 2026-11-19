import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { onScopeDispose, shallowReadonly, shallowRef, type ShallowRef, getCurrentScope } from "vue"

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
