import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"

export const driven = <A, E, R>(eff: Effect.Effect<A, E, R>, stepMs = 50, maxSteps = 20_000): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    let done = false
    const fiber = yield* Effect.forkChild(
      eff.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            done = true
          })
        )
      )
    )
    for (let i = 0; i < maxSteps && !done; i++) {
      yield* TestClock.adjust(stepMs)
    }
    return yield* Fiber.join(fiber)
  })
