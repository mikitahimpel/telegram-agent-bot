export type Period = {
  readonly from: Date
  readonly to: Date
  readonly label: string
}

const DAY = 86_400_000

export const parsePeriod = (input: string | undefined, now: Date): Period | undefined => {
  const text = (input ?? "").trim().toLowerCase()
  if (text === "") return parsePeriod("30d", now)
  const days = /^(\d{1,4})d$/.exec(text)
  if (days !== null) {
    const n = Number(days[1])
    if (n < 1) return undefined
    return { from: new Date(now.getTime() - n * DAY), to: now, label: `${n}d` }
  }
  if (text === "month") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now, label: "month" }
  }
  const ym = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text)
  if (ym !== null) {
    const y = Number(ym[1])
    const m = Number(ym[2]) - 1
    return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)), label: text }
  }
  return undefined
}
