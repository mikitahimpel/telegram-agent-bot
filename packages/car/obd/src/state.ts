import { Data } from "effect"
import type { ObdError } from "./errors.ts"
import type { SessionInfo } from "./session.ts"

export type ConnectionState = Data.TaggedEnum<{
  Idle: {}
  RequestingDevice: {}
  Connecting: { readonly deviceName: string }
  InitializingAdapter: { readonly step: number; readonly total: number; readonly label: string }
  WaitingForEcu: {}
  Ready: { readonly info: SessionInfo }
  /** Transport lost; `since`/`nextRetryAt` are epoch ms. */
  Lost: { readonly since: number; readonly attempt: number; readonly nextRetryAt: number }
  Failed: { readonly error: ObdError }
}>

export const ConnectionState = Data.taggedEnum<ConnectionState>()
