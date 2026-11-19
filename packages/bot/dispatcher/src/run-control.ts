import { Context, Effect, Exit, Fiber, FiberMap, Layer, Option, Semaphore } from "effect"
import { AgentBusy, RunInterrupted } from "@bot/core-contracts/errors"
import type { SessionKey } from "@bot/core-contracts/ids"
import { RunControl } from "@bot/core-contracts/run-control"

/** Per-session exclusive execution: one run per session, a second one is rejected (never queued). */
export class RunSlots extends Context.Service<
  RunSlots,
  {
    readonly runExclusive: <A, E, R>(
      key: SessionKey,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | AgentBusy | RunInterrupted, R>
  }
>()("@bot/RunSlots") {}

/** Provides `RunControl` (public) and `RunSlots` (used by the dispatcher), backed by one FiberMap. */
export const layer: Layer.Layer<RunControl | RunSlots> = Layer.effectContext(
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<SessionKey, Exit.Exit<unknown, unknown>>()
    const semaphores = new Map<SessionKey, Semaphore.Semaphore>()
    const semaphoreOf = (key: SessionKey) => {
      let s = semaphores.get(key)
      if (s === undefined) {
        s = Semaphore.makeUnsafe(1)
        semaphores.set(key, s)
      }
      return s
    }

    const slots = RunSlots.of({
      runExclusive: <A, E, R>(key: SessionKey, effect: Effect.Effect<A, E, R>) =>
        semaphoreOf(key)
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              // The fiber itself never fails: interruption by `stop` is observed through Fiber.await.
              const fiber = yield* FiberMap.run(fibers, key, Effect.exit(effect))
              const outer = yield* Fiber.await(fiber)
              if (Exit.isFailure(outer)) return yield* new RunInterrupted({ sessionKey: key })
              const inner = outer.value as Exit.Exit<A, E>
              return yield* inner
            })
          )
          .pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new AgentBusy({ sessionKey: key })),
                onSome: Effect.succeed
              })
            )
          )
    })

    const control = RunControl.of({
      stop: (key) =>
        Effect.gen(function* () {
          const has = yield* FiberMap.has(fibers, key)
          if (has) yield* FiberMap.remove(fibers, key)
          return has
        }),
      stopAll: Effect.gen(function* () {
        const keys = yield* running
        yield* FiberMap.clear(fibers)
        return keys.length
      }),
      running: Effect.suspend(() => running)
    })
    const running = Effect.sync(() => {
      const out: Array<SessionKey> = []
      for (const [key] of fibers) out.push(key)
      return out
    })

    return Context.make(RunSlots, slots).pipe(Context.add(RunControl, control))
  })
)
