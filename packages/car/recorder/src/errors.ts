import { Data } from "effect"
import type { ApiErrorCode } from "@bot/car-format/api"

export type StorageFailureReason = "quota" | "unavailable" | "unknown"

export class StorageFailure extends Data.TaggedError("StorageFailure")<{
  readonly reason: StorageFailureReason
  readonly message: string
  readonly cause?: unknown
}> {}

export class ApiFailure extends Data.TaggedError("ApiFailure")<{
  readonly code: ApiErrorCode | "network" | "timeout"
  readonly retryable: boolean
  readonly message: string
  readonly status?: number
}> {}

export class RecorderFailure extends Data.TaggedError("RecorderFailure")<{
  readonly reason: "busy" | "not_found" | "not_interrupted"
  readonly message: string
}> {}

export class ExportFailure extends Data.TaggedError("ExportFailure")<{
  readonly reason: "not_found" | "chunk_missing"
  readonly message: string
}> {}

export const classifyStorageError = (cause: unknown): StorageFailure => {
  const name = typeof cause === "object" && cause !== null && "name" in cause ? String((cause as { name: unknown }).name) : ""
  const message = cause instanceof Error ? cause.message : String(cause)
  if (name === "QuotaExceededError" || /quota/i.test(message)) {
    return new StorageFailure({ reason: "quota", message: "Not enough storage space on this phone", cause })
  }
  if (name === "InvalidStateError" || name === "SecurityError" || name === "UnknownError" || /indexeddb is not available/i.test(message)) {
    return new StorageFailure({ reason: "unavailable", message: "Browser storage is unavailable", cause })
  }
  return new StorageFailure({ reason: "unknown", message, cause })
}
