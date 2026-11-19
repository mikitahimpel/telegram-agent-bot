import { Context, Effect, Layer, Scope } from "effect"
import { bleRequestDevice, bleSupport, type BleSupport } from "@bot/car-obd/transport"
import { PermissionDenied, type ObdError } from "@bot/car-obd/errors"
import { connect, type ConnectOptions, type ObdSession } from "@bot/car-obd/session"
import type { SimCar, SimulatorScenario } from "@bot/car-obd/transport"
import type { RememberedAdapter } from "./adapter-memory.ts"

export type PickedAdapter = { readonly id: string; readonly name: string; readonly handle: unknown }

export type ConnectTarget =
  | { readonly _tag: "Picked"; readonly picked: PickedAdapter }
  | { readonly _tag: "Remembered"; readonly adapter: RememberedAdapter }

export class ObdConnector extends Context.Service<
  ObdConnector,
  {
    readonly support: Effect.Effect<BleSupport>
    readonly pick: Effect.Effect<PickedAdapter, ObdError>
    readonly connect: (
      target: ConnectTarget,
      options?: Pick<ConnectOptions, "onState" | "reconnect">
    ) => Effect.Effect<ObdSession, ObdError, Scope.Scope>
  }
>()("@bot/car-recorder/ObdConnector") {}

export const connectorBrowserLayer: Layer.Layer<ObdConnector> = Layer.succeed(ObdConnector, {
  support: Effect.sync(bleSupport),
  pick: bleRequestDevice().pipe(
    Effect.map((d): PickedAdapter => ({ id: d.id, name: d.name ?? "Bluetooth OBD adapter", handle: d }))
  ),
  connect: (target, options = {}) =>
    target._tag === "Picked"
      ? connect("ble", { ...options, waitForEcu: true, device: target.picked.handle as BluetoothDevice })
      : connect("ble", { ...options, waitForEcu: true, remembered: { deviceId: target.adapter.deviceId } })
})

export type FakeConnectorControl = {
  support: BleSupport
  silentFailure: ((attempt: number) => ObdError | undefined) | undefined
  pickFailure: ObdError | undefined
  silentAttempts: number
  picks: number
  car: SimCar | undefined
  scenario: SimulatorScenario
}

export const connectorFake = (init: Partial<FakeConnectorControl> = {}) =>
  Effect.sync(() => {
    const control: FakeConnectorControl = {
      support: { ble: true, getDevices: true, watchAdvertisements: true },
      silentFailure: undefined,
      pickFailure: undefined,
      silentAttempts: 0,
      picks: 0,
      car: undefined,
      scenario: "normal",
      ...init
    }
    const sim = (options: Pick<ConnectOptions, "onState" | "reconnect">) =>
      connect("simulator", {
        ...options,
        scenario: control.scenario,
        waitForEcu: true,
        ...(control.car !== undefined ? { car: control.car } : {})
      })
    const layer = Layer.succeed(ObdConnector, {
      support: Effect.sync(() => control.support),
      pick: Effect.suspend(() => {
        control.picks += 1
        return control.pickFailure !== undefined
          ? Effect.fail(control.pickFailure)
          : Effect.succeed<PickedAdapter>({ id: "sim-1", name: "Simulated ELM327", handle: undefined })
      }),
      connect: (target, options = {}) =>
        Effect.suspend(() => {
          if (target._tag === "Remembered") {
            control.silentAttempts += 1
            const failure = control.silentFailure?.(control.silentAttempts)
            if (failure !== undefined) return Effect.fail(failure)
          }
          return sim(options)
        })
    })
    return { layer, control }
  })

export const gestureDenied = (): ObdError => new PermissionDenied({ detail: "user gesture required" })
