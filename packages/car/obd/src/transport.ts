import { Effect, Queue, Scope, Stream } from "effect"
import type { Cause } from "effect"
import {
  AdapterNotResponding,
  BluetoothUnavailable,
  DeviceNotSelected,
  Disconnected,
  type ObdError,
  PermissionDenied,
  SerialUnavailable,
  ReconnectUnavailable,
  UnsupportedDevice
} from "./errors.ts"

export { simulatorTransport } from "./simulator.ts"
export { crankingScript, makeSimCar } from "./simulator.ts"
export type { SimCar, SimEcu, SimulatorScenario, SimulatorOptions } from "./simulator.ts"

export type TransportKind = "ble" | "serial" | "simulator"

export type ObdTransport = {
  readonly kind: TransportKind
  readonly name: string
  readonly deviceId?: string
  readonly write: (line: string) => Effect.Effect<void, Disconnected>
  readonly incoming: Stream.Stream<string, Disconnected>
  readonly close: Effect.Effect<void>
  readonly reopen: Effect.Effect<ObdTransport, ObdError, Scope.Scope>
}

export type IncomingQueue = Queue.Queue<string, Disconnected | Cause.Done>

export const BLE_SERVICES: ReadonlyArray<{ service: BluetoothServiceUUID; notify: BluetoothCharacteristicUUID; write: BluetoothCharacteristicUUID }> = [
  { service: 0xfff0, notify: 0xfff1, write: 0xfff2 },
  { service: 0xffe0, notify: 0xffe1, write: 0xffe1 },
  { service: 0x18f0, notify: 0x2af0, write: 0x2af1 },
  {
    service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    notify: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
    write: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"
  }
]

const uuidLabel = (u: BluetoothServiceUUID): string =>
  typeof u === "number" ? u.toString(16).toUpperCase().padStart(4, "0") : String(u)

const errName = (e: unknown): string => (e instanceof Error ? e.name : "")
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const mapRequestError = (e: unknown): ObdError => {
  const name = errName(e)
  const msg = errMessage(e).toLowerCase()
  if (name === "NotFoundError") {
    return /adapter|turned off|not available/.test(msg) && !/cancel/.test(msg)
      ? new BluetoothUnavailable({ reason: "adapter_off" })
      : new DeviceNotSelected()
  }
  if (name === "SecurityError" || name === "NotAllowedError") return new PermissionDenied({ detail: errMessage(e) })
  return new PermissionDenied({ detail: errMessage(e) })
}

const chunkBytes = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size))
  return out
}

export const bleRequestDevice = (options?: { readonly namePrefix?: string }): Effect.Effect<BluetoothDevice, ObdError> =>
  Effect.gen(function*() {
    if (typeof navigator === "undefined" || navigator.bluetooth === undefined) {
      return yield* new BluetoothUnavailable({ reason: "unsupported" })
    }
    if (typeof isSecureContext !== "undefined" && !isSecureContext) {
      return yield* new BluetoothUnavailable({ reason: "insecure_context" })
    }
    const bt = navigator.bluetooth
    const optionalServices = BLE_SERVICES.map((s) => s.service)
    return yield* Effect.tryPromise({
      try: () =>
        options?.namePrefix !== undefined
          ? bt.requestDevice({ filters: [{ namePrefix: options.namePrefix }], optionalServices })
          : bt.requestDevice({ acceptAllDevices: true, optionalServices }),
      catch: mapRequestError
    })
  })

export const bleTransport = (options?: { readonly namePrefix?: string }): Effect.Effect<ObdTransport, ObdError, Scope.Scope> =>
  Effect.flatMap(bleRequestDevice(options), (device) => bleConnect(device))

export const bleOpenDevice = (device: BluetoothDevice): Effect.Effect<ObdTransport, ObdError, Scope.Scope> => bleConnect(device)

export type BleSupport = { readonly ble: boolean; readonly getDevices: boolean; readonly watchAdvertisements: boolean }

export const bleSupport = (): BleSupport => {
  const bt = typeof navigator === "undefined" ? undefined : navigator.bluetooth
  const proto = (globalThis as { BluetoothDevice?: { readonly prototype: object } }).BluetoothDevice?.prototype
  return {
    ble: bt !== undefined,
    getDevices: bt !== undefined && typeof bt.getDevices === "function",
    watchAdvertisements: proto !== undefined && "watchAdvertisements" in proto
  }
}

const waitForAdvertisement = (device: BluetoothDevice, waitMs: number): Effect.Effect<boolean> =>
  Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        const controller = new AbortController()
        let settled = false
        const finish = (found: boolean) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          device.removeEventListener("advertisementreceived", onAd)
          controller.abort()
          resolve(found)
        }
        const onAd = () => finish(true)
        const timer = setTimeout(() => finish(false), waitMs)
        device.addEventListener("advertisementreceived", onAd)
        device.watchAdvertisements({ signal: controller.signal }).catch(() => finish(false))
      })
  )

export const bleOpenRemembered = (
  deviceId: string,
  options: { readonly advertisementWaitMs?: number } = {}
): Effect.Effect<ObdTransport, ObdError, Scope.Scope> =>
  Effect.gen(function*() {
    if (typeof navigator === "undefined" || navigator.bluetooth === undefined) {
      return yield* new BluetoothUnavailable({ reason: "unsupported" })
    }
    const bt = navigator.bluetooth
    if (typeof bt.getDevices !== "function") return yield* new ReconnectUnavailable({ reason: "unsupported" })
    const devices = yield* Effect.tryPromise({ try: () => bt.getDevices(), catch: () => new ReconnectUnavailable({ reason: "unsupported" }) })
    const device = devices.find((d) => d.id === deviceId)
    if (device === undefined) return yield* new ReconnectUnavailable({ reason: "forgotten" })
    const direct = yield* Effect.result(bleConnect(device))
    if (direct._tag === "Success") return direct.success
    const failure = direct.failure
    if (failure._tag === "PermissionDenied") return yield* new ReconnectUnavailable({ reason: "gesture_required" })
    if (!bleSupport().watchAdvertisements) return yield* new ReconnectUnavailable({ reason: "out_of_range" })
    const seen = yield* waitForAdvertisement(device, options.advertisementWaitMs ?? 20_000)
    if (!seen) return yield* new ReconnectUnavailable({ reason: "out_of_range" })
    return yield* bleConnect(device).pipe(
      Effect.mapError((e): ObdError => (e._tag === "PermissionDenied" ? new ReconnectUnavailable({ reason: "gesture_required" }) : e))
    )
  })

const bleConnect = (device: BluetoothDevice): Effect.Effect<ObdTransport, ObdError, Scope.Scope> =>
  Effect.gen(function*() {
    const gatt = device.gatt
    if (gatt === undefined) return yield* new BluetoothUnavailable({ reason: "unsupported" })
    const server = yield* Effect.tryPromise({
      try: () => gatt.connect(),
      catch: (e) =>
        errName(e) === "SecurityError" || errName(e) === "NotAllowedError"
          ? new PermissionDenied({ detail: errMessage(e) })
          : new Disconnected()
    })

    const tried: string[] = []
    let found: { notify: BluetoothRemoteGATTCharacteristic; write: BluetoothRemoteGATTCharacteristic } | undefined
    for (const known of BLE_SERVICES) {
      tried.push(uuidLabel(known.service))
      const service = yield* Effect.tryPromise({ try: () => server.getPrimaryService(known.service), catch: () => undefined }).pipe(
        Effect.orElseSucceed(() => undefined)
      )
      if (service === undefined) continue
      const chars = yield* Effect.tryPromise({ try: () => service.getCharacteristics(), catch: () => undefined }).pipe(
        Effect.orElseSucceed(() => undefined)
      )
      if (chars === undefined) continue
      const notifiable = chars.filter((c) => c.properties.notify || c.properties.indicate)
      const writable = chars.filter((c) => c.properties.write || c.properties.writeWithoutResponse)
      const prefer = (list: BluetoothRemoteGATTCharacteristic[], uuid: BluetoothCharacteristicUUID) =>
        list.find((c) => c.uuid === BluetoothUUID.canonicalUUID(uuid as number)) ?? list.find((c) => c.uuid === String(uuid)) ?? list[0]
      const notify = prefer(notifiable, known.notify)
      const write = prefer(writable, known.write)
      if (notify !== undefined && write !== undefined) {
        found = { notify, write }
        break
      }
    }
    if (found === undefined) {
      gatt.disconnect()
      return yield* new UnsupportedDevice({ triedServices: tried })
    }
    const { notify, write } = found

    const queue: IncomingQueue = yield* Queue.unbounded<string, Disconnected | Cause.Done>()
    const decoder = new TextDecoder()
    const onValue = (ev: Event) => {
      const value = (ev.target as BluetoothRemoteGATTCharacteristic).value
      if (value !== undefined && value !== null) Queue.offerUnsafe(queue, decoder.decode(value, { stream: true }))
    }
    const onDisconnected = () => {
      Effect.runFork(Queue.fail(queue, new Disconnected()))
    }
    notify.addEventListener("characteristicvaluechanged", onValue)
    device.addEventListener("gattserverdisconnected", onDisconnected)
    yield* Effect.tryPromise({ try: () => notify.startNotifications(), catch: () => new Disconnected() })

    const encoder = new TextEncoder()
    const withoutResponse = write.properties.writeWithoutResponse
    const transport: ObdTransport = {
      kind: "ble",
      name: device.name ?? "Bluetooth OBD adapter",
      deviceId: device.id,
      write: (line) =>
        Effect.tryPromise({
          try: async () => {
            for (const part of chunkBytes(encoder.encode(line + "\r"), 20)) {
              if (withoutResponse) await write.writeValueWithoutResponse(part as BufferSource)
              else await write.writeValueWithResponse(part as BufferSource)
            }
          },
          catch: () => new Disconnected()
        }),
      incoming: Stream.fromQueue(queue),
      close: Effect.sync(() => {
        notify.removeEventListener("characteristicvaluechanged", onValue)
        device.removeEventListener("gattserverdisconnected", onDisconnected)
        if (gatt.connected) gatt.disconnect()
      }),
      reopen: Effect.suspend(() => bleConnect(device))
    }
    yield* Effect.addFinalizer(() => transport.close)
    return transport
  })

const SERIAL_PROBE_MS = 1500

type OpenPort = {
  readonly baud: number
  readonly reader: ReadableStreamDefaultReader<Uint8Array>
  readonly writer: WritableStreamDefaultWriter<Uint8Array>
  readonly firstText: string
}

const probePort = async (port: SerialPort, baudRates: ReadonlyArray<number>): Promise<OpenPort | string> => {
  let last = ""
  for (const baudRate of baudRates) {
    try {
      await port.open({ baudRate })
    } catch (e) {
      last = errMessage(e)
      continue
    }
    const reader = port.readable!.getReader()
    const writer = port.writable!.getWriter()
    const decoder = new TextDecoder()
    let text = ""
    try {
      await writer.write(new TextEncoder().encode("ATI\r"))
      const deadline = Date.now() + SERIAL_PROBE_MS
      while (!text.includes(">") && Date.now() < deadline) {
        const timer = setTimeout(() => void reader.cancel().catch(() => undefined), Math.max(1, deadline - Date.now()))
        const { value, done } = await reader.read()
        clearTimeout(timer)
        if (done) break
        if (value !== undefined) text += decoder.decode(value, { stream: true })
      }
    } catch (e) {
      last = errMessage(e)
    }
    if (text.includes(">")) return { baud: baudRate, reader, writer, firstText: text }
    last = text
    try {
      reader.releaseLock()
    } catch {}
    try {
      writer.releaseLock()
    } catch {}
    await port.close().catch(() => undefined)
  }
  return last
}

export const serialTransport = (options?: { readonly baudRate?: number; readonly baudRates?: ReadonlyArray<number> }): Effect.Effect<ObdTransport, ObdError, Scope.Scope> =>
  Effect.gen(function*() {
    if (typeof navigator === "undefined" || navigator.serial === undefined) return yield* new SerialUnavailable()
    const serial = navigator.serial
    const port = yield* Effect.tryPromise({
      try: () => serial.requestPort(),
      catch: (e): ObdError =>
        errName(e) === "NotFoundError" ? new DeviceNotSelected() : new PermissionDenied({ detail: errMessage(e) })
    })
    const rates = options?.baudRates ?? (options?.baudRate !== undefined ? [options.baudRate] : [38400, 9600, 115200])
    return yield* serialOpen(port, rates)
  })

const serialOpen = (port: SerialPort, rates: ReadonlyArray<number>): Effect.Effect<ObdTransport, ObdError, Scope.Scope> =>
  Effect.gen(function*() {
    const opened = yield* Effect.tryPromise({ try: () => probePort(port, rates), catch: () => new Disconnected() })
    if (typeof opened === "string") {
      return yield* new AdapterNotResponding({ step: `baud:${rates.join("/")}`, lastResponse: opened })
    }
    const { reader, writer, baud, firstText } = opened
    const queue: IncomingQueue = yield* Queue.unbounded<string, Disconnected | Cause.Done>()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let closing = false
    const info = port.getInfo()
    const pump = Effect.gen(function*() {
      while (true) {
        const result = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new Disconnected() })
        if (result.done) return yield* new Disconnected()
        if (result.value !== undefined) yield* Queue.offer(queue, decoder.decode(result.value, { stream: true }))
      }
    }).pipe(Effect.catch(() => (closing ? Effect.void : Queue.fail(queue, new Disconnected()))))
    yield* Effect.forkScoped(pump)
    void firstText

    const transport: ObdTransport = {
      kind: "serial",
      name: info.usbVendorId !== undefined ? `USB serial ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)} @${baud}` : `Serial adapter @${baud}`,
      write: (line) =>
        Effect.tryPromise({ try: () => writer.write(encoder.encode(line + "\r")), catch: () => new Disconnected() }),
      incoming: Stream.fromQueue(queue),
      close: Effect.promise(async () => {
        closing = true
        await reader.cancel().catch(() => undefined)
        try {
          reader.releaseLock()
        } catch {}
        try {
          writer.releaseLock()
        } catch {}
        await port.close().catch(() => undefined)
      }),
      reopen: Effect.suspend(() => serialOpen(port, [baud]))
    }
    yield* Effect.addFinalizer(() => transport.close)
    return transport
  })
