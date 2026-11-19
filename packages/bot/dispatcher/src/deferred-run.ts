import { Schema } from "effect"
import { Lang } from "@bot/core-contracts/lang"
import { Role } from "@bot/core-contracts/ids"

export const DEFERRED_RUN_KIND = "deferred_run"

export const DeferredRunPayload = Schema.Struct({
  tgId: Schema.Number,
  chatId: Schema.Number,
  threadId: Schema.optionalKey(Schema.Number),
  lang: Lang,
  role: Role,
  prompt: Schema.String
})
export type DeferredRunPayload = typeof DeferredRunPayload.Type

const codec = Schema.fromJsonString(DeferredRunPayload)
export const encodeDeferredPayload = Schema.encodeSync(codec)
export const decodeDeferredPayload = Schema.decodeUnknownOption(codec)

export const deferredJobId = (tgId: number, sessionKey: string): string => `${DEFERRED_RUN_KIND}:${tgId}:${sessionKey}`

export const FALLBACK_RETRY_MS = 30 * 60_000
export const RESET_GRACE_MS = 60_000
