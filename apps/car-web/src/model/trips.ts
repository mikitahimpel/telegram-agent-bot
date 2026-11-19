import type { TripVm } from "./types.ts"

export type TripGroup = "attention" | "inProgress" | "done"

export const tripGroup = (t: TripVm): TripGroup => {
  switch (t.sync._tag) {
    case "Incomplete":
    case "Waiting":
      return "attention"
    case "Confirmed":
    case "CloudOnly":
      return "done"
    default:
      return "inProgress"
  }
}

export const groupTrips = (trips: TripVm[]): Record<TripGroup, TripVm[]> => {
  const out: Record<TripGroup, TripVm[]> = { attention: [], inProgress: [], done: [] }
  for (const t of [...trips].sort((a, b) => b.startedAt - a.startedAt)) out[tripGroup(t)].push(t)
  return out
}

export const tripCounters = (t: TripVm) => ({
  recorded: t.points,
  sent: t.chunks.filter((c) => c.state === "sent" || c.state === "confirmed").length,
  confirmed: t.chunks.filter((c) => c.state === "confirmed").length,
  total: t.chunks.length
})

export const canDeleteLocal = (t: TripVm): boolean => t.sync._tag === "Confirmed" && t.localCopy
