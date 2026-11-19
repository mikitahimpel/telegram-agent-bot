import { ConnectionState } from "@bot/car-obd/state"
import type { ObdError } from "@bot/car-obd/errors"
import type { SessionInfo } from "@bot/car-obd/session"
import type { ConnError, ConnectionVm, FuelRateSource, SensorKey } from "../model/types.ts"

export const mapObdError = (e: ObdError): ConnError => {
  switch (e._tag) {
    case "BluetoothUnavailable":
      return { code: e._tag, reason: e.reason, detail: `${e._tag}: ${e.reason}` }
    case "AdapterNotResponding":
      return { code: e._tag, step: e.step, detail: `step ${e.step}, last response: ${JSON.stringify(e.lastResponse)}` }
    case "EcuNotResponding":
      return { code: e._tag, detail: `response: ${JSON.stringify(e.response)}` }
    case "CommandTimeout":
      return { code: e._tag, detail: `command: ${e.command}` }
    case "CommandRejected":
      return { code: e._tag, reason: e.token, detail: `${e.command} -> ${e.token}` }
    case "UnsupportedDevice":
      return { code: e._tag, detail: `tried services: ${e.triedServices.join(", ")}` }
    case "PermissionDenied":
      return { code: e._tag, ...(e.detail ? { detail: e.detail } : {}) }
    case "ReconnectUnavailable":
      return { code: "DeviceNotSelected", reason: e.reason }
    case "SerialUnavailable":
    case "DeviceNotSelected":
    case "Disconnected":
      return { code: e._tag }
  }
}

const PID_TO_SENSOR: Record<string, SensorKey> = { "0D": "speedKmh", "0C": "rpm", "05": "coolantC", "42": "voltageV" }

export const sensorsFromInfo = (info: Pick<SessionInfo, "supportedPids" | "fuelRateSource">): SensorKey[] => {
  const out = new Set<SensorKey>(["voltageV"])
  for (const pid of info.supportedPids) {
    const k = PID_TO_SENSOR[pid.toUpperCase()]
    if (k) out.add(k)
  }
  if (info.fuelRateSource !== "none") out.add("fuelRateLph")
  return [...out]
}

export const mapConnectionState = (s: ConnectionState): ConnectionVm => {
  switch (s._tag) {
    case "Idle":
      return { _tag: "Idle" }
    case "RequestingDevice":
      return { _tag: "RequestingDevice" }
    case "Connecting":
      return { _tag: "Connecting" }
    case "InitializingAdapter":
      return { _tag: "InitializingAdapter", step: s.step, total: s.total, label: s.label }
    case "WaitingForEcu":
      return { _tag: "WaitingForEcu" }
    case "Ready":
      return {
        _tag: "Ready",
        adapterName: s.info.adapterName,
        sensors: sensorsFromInfo(s.info).length,
        supportedPids: [...s.info.supportedPids],
        fuelRateSource: s.info.fuelRateSource as FuelRateSource
      }
    case "Lost":
      return { _tag: "Lost", since: s.since, attempt: s.attempt, nextRetryAt: s.nextRetryAt }
    case "Failed":
      return { _tag: "Failed", error: mapObdError(s.error) }
  }
}

export { ConnectionState }
