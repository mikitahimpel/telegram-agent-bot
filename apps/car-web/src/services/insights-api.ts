import { Schema } from "effect"
import { Alert, AlertList, CarOverview, TripInsight, TripSeries } from "@bot/car-format/insights"

export type InsightsErrorCode = "not_paired" | "network" | "unauthorized" | "not_found" | "server" | "invalid"

export class InsightsError extends Error {
  constructor(
    readonly code: InsightsErrorCode,
    message?: string
  ) {
    super(message ?? code)
  }
}

const codeFor = (status: number): InsightsErrorCode =>
  status === 401 || status === 403 ? "unauthorized" : status === 404 ? "not_found" : "server"

export const getJson = async <A, I>(
  base: string,
  path: string,
  token: string,
  schema: Schema.Codec<A, I>,
  fetchFn: typeof fetch = fetch
): Promise<A> => {
  let res: Response
  try {
    res = await fetchFn(`${base}${path}`, { headers: { authorization: `Device ${token}` } })
  } catch {
    throw new InsightsError("network")
  }
  if (!res.ok) throw new InsightsError(codeFor(res.status), `HTTP ${res.status}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new InsightsError("invalid")
  }
  try {
    return Schema.decodeUnknownSync(schema)(body)
  } catch {
    throw new InsightsError("invalid")
  }
}

export const insightsApi = (base: string, token: string, fetchFn?: typeof fetch) => ({
  overview: () => getJson(base, "/overview", token, CarOverview, fetchFn),
  tripInsight: (id: string) => getJson(base, `/trips/${encodeURIComponent(id)}/insight`, token, TripInsight, fetchFn),
  tripSeries: (id: string) =>
    getJson(
      base,
      `/trips/${encodeURIComponent(id)}/series?points=600&columns=speed_kmh,rpm,coolant_c,fuel_rate_lph,voltage_v,lat,lon`,
      token,
      TripSeries,
      fetchFn
    ),
  alerts: async (): Promise<ReadonlyArray<Alert>> => (await getJson(base, "/alerts", token, AlertList, fetchFn)).alerts
})
