export interface Capabilities {
  readonly ble: boolean
  readonly serial: boolean
  readonly secureContext: boolean
  readonly inTelegram: boolean
  readonly reasons: string[]
}

interface Env {
  readonly navigator?: { readonly bluetooth?: unknown; readonly serial?: unknown; readonly userAgent?: string }
  readonly isSecureContext?: boolean
  readonly Telegram?: { readonly WebApp?: { readonly initData?: string } }
}

export const detectCapabilities = (env: Env = globalThis as unknown as Env): Capabilities => {
  const nav = env.navigator
  const secureContext = env.isSecureContext === true
  const ble = nav?.bluetooth !== undefined
  const serial = nav?.serial !== undefined
  const inTelegram = (env.Telegram?.WebApp?.initData ?? "") !== ""
  const reasons: string[] = []
  if (!secureContext) reasons.push("insecure_context")
  if (!ble) reasons.push("ble_unsupported")
  if (!serial) reasons.push("serial_unsupported")
  if (/iPhone|iPad|iPod/.test(nav?.userAgent ?? "")) reasons.push("ios_webkit")
  return { ble: ble && secureContext, serial: serial && secureContext, secureContext, inTelegram, reasons }
}
