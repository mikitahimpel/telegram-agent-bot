import type { Lang } from "../i18n/format.ts"
import { makeT } from "../i18n/index.ts"
import { describeStatus, type StatusView } from "./describe-status.ts"
import type { Capabilities, ConnectionVm, TransportKind } from "./types.ts"

export type StepId = "browser" | "bluetooth" | "choose" | "adapter" | "car" | "sensors"
export type StepStatus = "pending" | "active" | "done" | "failed"

export interface WizardStep {
  id: StepId
  label: string
  status: StepStatus
  /** Present when failed: human explanation + fix + action. */
  problem?: StatusView
  note?: string
}

const ORDER: StepId[] = ["browser", "bluetooth", "choose", "adapter", "car", "sensors"]

const failedStep = (code: string, caps: Pick<Capabilities, "ble" | "serial">, transport: TransportKind): StepId => {
  switch (code) {
    case "BluetoothUnavailable":
      return caps.ble || transport !== "ble" ? "bluetooth" : "browser"
    case "SerialUnavailable":
      return "browser"
    case "PermissionDenied":
    case "DeviceNotSelected":
      return "choose"
    case "UnsupportedDevice":
    case "AdapterNotResponding":
    case "Disconnected":
      return "adapter"
    default:
      return "car"
  }
}

const activeIndex = (c: ConnectionVm): number => {
  switch (c._tag) {
    case "Idle":
      return 0
    case "RequestingDevice":
      return 2
    case "Connecting":
    case "InitializingAdapter":
      return 3
    case "WaitingForEcu":
      return 4
    case "Ready":
      return 6
    case "Lost":
      return 3
    case "Failed":
      return -1
  }
}

export const wizardSteps = (
  conn: ConnectionVm,
  caps: Pick<Capabilities, "ble" | "serial" | "secureContext">,
  transport: TransportKind,
  lang: Lang
): WizardStep[] => {
  const t = makeT(lang)
  const label = (id: StepId): string => {
    if (transport === "simulator" && (id === "browser" || id === "bluetooth")) return t("connect.step.demo")
    if (id === "bluetooth") return transport === "serial" ? t("connect.step.usb") : t("connect.step.bluetooth")
    return t(`connect.step.${id}`)
  }
  const failed = conn._tag === "Failed" ? failedStep(conn.error.code, caps, transport) : null
  const failIdx = failed ? ORDER.indexOf(failed) : -1
  const act = activeIndex(conn)
  const supported = transport === "simulator" || (transport === "ble" ? caps.ble : caps.serial)
  return ORDER.map((id, idx): WizardStep => {
    const step: WizardStep = { id, label: label(id), status: "pending" }
    if (failIdx >= 0) {
      step.status = idx < failIdx ? "done" : idx === failIdx ? "failed" : "pending"
      if (idx === failIdx && conn._tag === "Failed") {
        step.problem = describeStatus({ kind: "error", code: conn.error.code, step: conn.error.step, detail: conn.error.detail }, lang)
      }
    } else if (conn._tag === "Idle") {
      step.status = idx === 0 ? (supported && caps.secureContext !== false ? "done" : "failed") : "pending"
    } else {
      step.status = idx < act ? "done" : idx === act ? "active" : "pending"
    }
    if (id === "sensors" && conn._tag === "Ready") step.note = t("connect.step.sensors.n", { n: conn.sensors })
    if (id === "adapter" && conn._tag === "InitializingAdapter") step.note = `${conn.step}/${conn.total} ${conn.label}`
    return step
  })
}
