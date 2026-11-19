import { Context, Effect, Layer, PubSub, Queue, Ref, Stream } from "effect"

export type GeoFix = {
  readonly ts: number
  readonly lat: number
  readonly lon: number
  readonly accuracyM?: number | undefined
  readonly speedKmh?: number | undefined
}

export type GeoFailureReason = "denied" | "unavailable" | "timeout"
export type GeoFailure = {
  readonly _tag: "GeoFailure"
  readonly reason: GeoFailureReason
}

export class GeoSource extends Context.Service<GeoSource, {
  readonly watch: Stream.Stream<GeoFix, GeoFailure>
}>()("@bot/car-recorder/GeoSource") {}

export const geoBrowserLayer: Layer.Layer<GeoSource> = Layer.succeed(GeoSource, {
  watch: Stream.callback<GeoFix, GeoFailure>((queue) =>
    Effect.gen(function*() {
      const geo = typeof navigator === "undefined" ? undefined : navigator.geolocation
      if (geo === undefined) {
        yield* Queue.fail(queue, { _tag: "GeoFailure", reason: "unavailable" })
        return
      }
      const id = geo.watchPosition(
        (p) => {
          const speed = p.coords.speed
          Queue.offerUnsafe(queue, {
            ts: p.timestamp,
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            accuracyM: p.coords.accuracy,
            speedKmh: speed === null || !Number.isFinite(speed) ? undefined : speed * 3.6
          })
        },
        (e) => {
          Effect.runSync(
            Queue.fail(queue, { _tag: "GeoFailure", reason: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" })
          )
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => geo.clearWatch(id)))
    })
  )
})

export type FakeGeo = {
  readonly layer: Layer.Layer<GeoSource>
  readonly emit: (fix: GeoFix) => Effect.Effect<void>
}
export const makeFakeGeo = Effect.gen(function*() {
  const pubsub = yield* PubSub.unbounded<GeoFix>()
  const layer = Layer.succeed(GeoSource, { watch: Stream.fromPubSub(pubsub) })
  return { layer, emit: (fix: GeoFix) => PubSub.publish(pubsub, fix).pipe(Effect.asVoid) } satisfies FakeGeo
})

export class WakeLock extends Context.Service<WakeLock, {
  readonly acquire: Effect.Effect<boolean>
  readonly release: Effect.Effect<void>
  readonly hold: Effect.Effect<boolean>
  readonly unhold: Effect.Effect<void>
}>()("@bot/car-recorder/WakeLock") {}

export const wakeLockBrowserLayer: Layer.Layer<WakeLock> = Layer.sync(WakeLock, () => {
  let sentinel: WakeLockSentinel | undefined
  const owners = new Set<string>()
  const ensure = Effect.promise(async () => {
    if (sentinel !== undefined && !sentinel.released) return true
    try {
      const api = typeof navigator === "undefined" ? undefined : navigator.wakeLock
      if (api === undefined) return false
      sentinel = await api.request("screen")
      return true
    } catch {
      return false
    }
  })
  const drop = Effect.promise(async () => {
    if (owners.size > 0) return
    const s = sentinel
    sentinel = undefined
    try {
      await s?.release()
    } catch {
    }
  })
  const take = (owner: string) => Effect.suspend(() => (owners.add(owner), ensure))
  const give = (owner: string) => Effect.suspend(() => (owners.delete(owner), drop))
  return { acquire: take("recorder"), release: give("recorder"), hold: take("connection"), unhold: give("connection") }
})

export const wakeLockFake = Effect.sync(() => {
  const log: Array<"acquire" | "release" | "hold" | "unhold"> = []
  const layer = Layer.succeed(WakeLock, {
    acquire: Effect.sync(() => (log.push("acquire"), true)),
    release: Effect.sync(() => void log.push("release")),
    hold: Effect.sync(() => (log.push("hold"), true)),
    unhold: Effect.sync(() => void log.push("unhold"))
  })
  return { layer, log }
})

export type Visibility = "visible" | "hidden"

export class AppLifecycle extends Context.Service<AppLifecycle, {
  readonly isOnline: Effect.Effect<boolean>
  readonly isVisible: Effect.Effect<boolean>
  readonly online: Stream.Stream<boolean>
  readonly visibility: Stream.Stream<Visibility>
}>()("@bot/car-recorder/AppLifecycle") {}

export const lifecycleBrowserLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
  isOnline: Effect.sync(() => typeof navigator === "undefined" || navigator.onLine !== false),
  isVisible: Effect.sync(() => typeof document === "undefined" || document.visibilityState !== "hidden"),
  online: Stream.callback<boolean>((queue) =>
    Effect.gen(function*() {
      const on = () => void Queue.offerUnsafe(queue, true)
      const off = () => void Queue.offerUnsafe(queue, false)
      globalThis.addEventListener("online", on)
      globalThis.addEventListener("offline", off)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.removeEventListener("online", on)
          globalThis.removeEventListener("offline", off)
        })
      )
    })
  ),
  visibility: Stream.callback<Visibility>((queue) =>
    Effect.gen(function*() {
      const f = () => void Queue.offerUnsafe(queue, document.visibilityState === "hidden" ? "hidden" : "visible")
      document.addEventListener("visibilitychange", f)
      yield* Effect.addFinalizer(() => Effect.sync(() => document.removeEventListener("visibilitychange", f)))
    })
  )
})

export type FakeLifecycle = {
  readonly layer: Layer.Layer<AppLifecycle>
  readonly setOnline: (online: boolean) => Effect.Effect<void>
  readonly setVisible: (visible: boolean) => Effect.Effect<void>
}
export const makeFakeLifecycle = Effect.gen(function*() {
  const onlineRef = yield* Ref.make(true)
  const visibleRef = yield* Ref.make(true)
  const onlinePs = yield* PubSub.unbounded<boolean>()
  const visPs = yield* PubSub.unbounded<Visibility>()
  const layer = Layer.succeed(AppLifecycle, {
    isOnline: Ref.get(onlineRef),
    isVisible: Ref.get(visibleRef),
    online: Stream.fromPubSub(onlinePs),
    visibility: Stream.fromPubSub(visPs)
  })
  return {
    layer,
    setOnline: (o: boolean) => Ref.set(onlineRef, o).pipe(Effect.andThen(PubSub.publish(onlinePs, o)), Effect.asVoid),
    setVisible: (v: boolean) =>
      Ref.set(visibleRef, v).pipe(Effect.andThen(PubSub.publish(visPs, v ? "visible" : "hidden")), Effect.asVoid)
  } satisfies FakeLifecycle
})
