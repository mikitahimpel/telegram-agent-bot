import { Effect } from "effect"
import { encodeCsv } from "@bot/car-format/csv"
import { ExportFailure, type StorageFailure } from "./errors.ts"
import { TripStore } from "./store.ts"

export interface ExportedTrip {
  readonly fileName: string
  readonly csv: Blob
  readonly manifestJson: Blob
  readonly manifestFileName: string
}

const stripHeader = (csv: string): string => {
  const i = csv.indexOf("\n")
  return i < 0 ? "" : csv.slice(i + 1)
}

export const exportTrip = (tripId: string): Effect.Effect<ExportedTrip, ExportFailure | StorageFailure, TripStore> =>
  Effect.gen(function*() {
    const store = yield* TripStore
    const trip = yield* store.getTrip(tripId)
    if (trip === undefined) return yield* Effect.fail(new ExportFailure({ reason: "not_found", message: `Trip ${tripId} not found` }))
    const chunks = yield* store.listChunks(tripId)
    const missing = trip.manifest.chunks.filter((c) => !chunks.some((x) => x.seq === c.seq))
    if (missing.length > 0) {
      return yield* Effect.fail(
        new ExportFailure({ reason: "chunk_missing", message: `Local copy lost parts: ${missing.map((m) => m.seq).join(", ")}` })
      )
    }
    const pending = yield* store.readPending(tripId)
    const parts: Array<string> = []
    chunks.forEach((c, i) => parts.push(i === 0 ? c.csv : stripHeader(c.csv)))
    if (pending.length > 0) {
      const text = encodeCsv(pending)
      parts.push(chunks.length === 0 ? text : stripHeader(text))
    }
    if (parts.length === 0) parts.push(encodeCsv([]))
    return {
      fileName: `car-${tripId}.csv`,
      csv: new Blob(parts, { type: "text/csv" }),
      manifestFileName: `car-${tripId}.manifest.json`,
      manifestJson: new Blob([JSON.stringify(trip.manifest, null, 2)], { type: "application/json" })
    }
  })

export type ShareResult = "shared" | "downloaded" | "cancelled"

export const shareFiles = (files: ReadonlyArray<{ readonly name: string; readonly blob: Blob }>, title?: string): Effect.Effect<ShareResult> =>
  Effect.promise(async (): Promise<ShareResult> => {
    const fileObjs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }))
    const nav = typeof navigator === "undefined" ? undefined : navigator
    if (nav?.canShare?.({ files: fileObjs }) === true && nav.share !== undefined) {
      try {
        await nav.share({ files: fileObjs, ...(title !== undefined ? { title } : {}) })
        return "shared"
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return "cancelled"
      }
    }
    for (const f of fileObjs) {
      const url = URL.createObjectURL(f)
      const a = document.createElement("a")
      a.href = url
      a.download = f.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
    return "downloaded"
  })
