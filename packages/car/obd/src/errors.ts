import { Data } from "effect"

export class BluetoothUnavailable extends Data.TaggedError("BluetoothUnavailable")<{
  readonly reason: "unsupported" | "adapter_off" | "insecure_context"
}> {
  readonly code = "bluetooth_unavailable" as const
}

export class SerialUnavailable extends Data.TaggedError("SerialUnavailable")<{}> {
  readonly code = "serial_unavailable" as const
}

export class PermissionDenied extends Data.TaggedError("PermissionDenied")<{
  readonly detail?: string | undefined
}> {
  readonly code = "permission_denied" as const
}

export class DeviceNotSelected extends Data.TaggedError("DeviceNotSelected")<{}> {
  readonly code = "device_not_selected" as const
}

export class UnsupportedDevice extends Data.TaggedError("UnsupportedDevice")<{
  readonly triedServices: ReadonlyArray<string>
}> {
  readonly code = "unsupported_device" as const
}

export class AdapterNotResponding extends Data.TaggedError("AdapterNotResponding")<{
  readonly step: string
  readonly lastResponse: string
}> {
  readonly code = "adapter_not_responding" as const
}

export class EcuNotResponding extends Data.TaggedError("EcuNotResponding")<{
  readonly response: string
}> {
  readonly code = "ecu_not_responding" as const
}

export class CommandTimeout extends Data.TaggedError("CommandTimeout")<{
  readonly command: string
}> {
  readonly code = "command_timeout" as const
}

export class CommandRejected extends Data.TaggedError("CommandRejected")<{
  readonly command: string
  readonly token: string
}> {
  readonly code = "command_rejected" as const
}

export class Disconnected extends Data.TaggedError("Disconnected")<{}> {
  readonly code = "disconnected" as const
}

export type ObdError =
  | BluetoothUnavailable
  | SerialUnavailable
  | PermissionDenied
  | DeviceNotSelected
  | UnsupportedDevice
  | AdapterNotResponding
  | EcuNotResponding
  | CommandTimeout
  | CommandRejected
  | Disconnected
