import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeDtc, parseDtcResponse, parseMonitorStatus } from "../src/dtc.ts"
import { parseVin } from "../src/elm327.ts"
import { connect } from "../src/session.ts"
import type { SimulatorScenario } from "../src/simulator.ts"
import { driven } from "./helpers.ts"

describe("dtc parsing", () => {
  it("decodes the four systems", () => {
    expect(decodeDtc(0x01, 0x33)).toBe("P0133")
    expect(decodeDtc(0x43, 0x00)).toBe("C0300")
    expect(decodeDtc(0x81, 0x23)).toBe("B0123")
    expect(decodeDtc(0xc1, 0x00)).toBe("U0100")
    expect(decodeDtc(0x31, 0x23)).toBe("P3123")
  })

  it("parses a CAN single frame with padding", () => {
    expect(parseDtcResponse(["43 02 01 33 04 20 00"], 0x43, "can")).toEqual(["P0133", "P0420"])
    expect(parseDtcResponse(["4300000000000000"], 0x43, "can")).toEqual([])
  })

  it("parses a CAN multi-frame response", () => {
    expect(parseDtcResponse(["00A", "0: 43 04 03 01 03 02", "1: 03 03 03 04 00 00 00"], 0x43, "can")).toEqual([
      "P0301",
      "P0302",
      "P0303",
      "P0304"
    ])
  })

  it("parses multiple ECUs and dedupes", () => {
    const lines = ["43 01 01 33 00 00 00", "43 02 01 33 C1 00 00", "00A", "0:430303010302", "1:03030000000000"]
    expect(parseDtcResponse(lines, 0x43, "can")).toEqual(["P0133", "U0100", "P0301", "P0302", "P0303"])
  })

  it("parses legacy KWP lines with 0000 padding", () => {
    expect(parseDtcResponse(["43 01 33 01 34 00 00", "43 00 00 00 00 00 00"], 0x43, "legacy")).toEqual([
      "P0133",
      "P0134"
    ])
  })

  it("ignores other services and noise", () => {
    expect(parseDtcResponse(["NO DATA"], 0x43)).toBeUndefined()
    expect(parseDtcResponse(["47 01 01 71 00 00 00"], 0x43)).toBeUndefined()
    expect(parseDtcResponse(["BUS INIT: OK", "47 01 01 71 00 00 00"], 0x47)).toEqual(["P0171"])
  })

  it("aggregates the monitor status across ECUs", () => {
    expect(parseMonitorStatus(["41 01 82 07 E5 00", "41 01 00 04 00 00"])).toEqual({ milOn: true, count: 2 })
    expect(parseMonitorStatus(["41 01 00 07 E5 00"])).toEqual({ milOn: false, count: 0 })
    expect(parseMonitorStatus(["NO DATA"])).toBeUndefined()
  })

  it("picks the VIN from the right ECU", () => {
    const vin = "WP0ZZZ99ZTS392124"
    const hex = [...vin].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    expect(
      parseVin([
        "009",
        "0:490201AABBCC",
        "1:DDEEFF00112233",
        "014",
        `0:490201${hex.slice(0, 6)}`,
        `1:${hex.slice(6, 20)}`,
        `2:${hex.slice(20)}`
      ])
    ).toBe(vin)
  })
})

const scan = (scenario: SimulatorScenario) =>
  Effect.scoped(
    driven(
      Effect.gen(function* () {
        const session = yield* connect("simulator", { scenario })
        return yield* session.scanDtc
      })
    )
  )

describe("dtc scan (simulator)", () => {
  it.effect("MIL on: stored, pending and permanent", () =>
    Effect.gen(function* () {
      const r = yield* scan("dtc_mil_on")
      expect(r.milOn).toBe(true)
      expect(r.reportedCount).toBe(2)
      expect(r.codes).toEqual([
        { code: "P0301", kind: "stored" },
        { code: "P0420", kind: "stored" },
        { code: "P0171", kind: "pending" },
        { code: "P0420", kind: "permanent" }
      ])
    })
  )

  it.effect("pending only: MIL off", () =>
    Effect.gen(function* () {
      const r = yield* scan("dtc_pending_only")
      expect(r.milOn).toBe(false)
      expect(r.codes).toEqual([{ code: "P0171", kind: "pending" }])
    })
  )

  it.effect("multi ECU with multi-frame", () =>
    Effect.gen(function* () {
      const r = yield* scan("dtc_multi_ecu")
      expect(r.milOn).toBe(true)
      expect(r.codes.filter((c) => c.kind === "stored").map((c) => c.code)).toEqual([
        "P0301",
        "P0302",
        "P0303",
        "P0304",
        "C0035"
      ])
      expect(r.codes.filter((c) => c.kind === "pending").map((c) => c.code)).toEqual(["U0100"])
    })
  )

  it.effect("no codes", () =>
    Effect.gen(function* () {
      const r = yield* scan("dtc_none")
      expect(r).toMatchObject({
        milOn: false,
        codes: [],
        modes: { stored: "read", pending: "read", permanent: "read" }
      })
    })
  )

  it.effect("legacy KWP", () =>
    Effect.gen(function* () {
      const r = yield* scan("dtc_legacy_kwp")
      expect(r.codes.map((c) => c.code)).toEqual(["P0133", "P0301", "P0420", "B1234"])
    })
  )

  it.effect("NO DATA everywhere fails as ECU not responding", () =>
    Effect.scoped(
      driven(
        Effect.gen(function* () {
          const session = yield* connect("simulator", { scenario: "dtc_no_data" })
          const e = yield* session.scanDtc.pipe(Effect.flip)
          expect(e._tag).toBe("EcuNotResponding")
        })
      )
    )
  )

  it.effect("VIN is read through the simulator", () =>
    Effect.scoped(
      driven(
        Effect.gen(function* () {
          const session = yield* connect("simulator", { scenario: "dtc_mil_on" })
          expect(session.info.vin).toBe("WP0ZZZ99ZTS392124")
        })
      )
    )
  )
})
