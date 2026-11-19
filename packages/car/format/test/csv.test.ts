import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { encodeCsv, parseCsv } from "../src/csv.ts"
import { makeTripId, TripId } from "../src/manifest.ts"
import { sha256Hex } from "../src/checksum.ts"

describe("csv", () => {
  it.effect("round-trips samples and keeps missing values missing", () =>
    Effect.gen(function*() {
      const samples = [{ ts: 1, speedKmh: 50.5, rpm: 2000 }, { ts: 2, lat: 52.1, lon: 21.0 }]
      const parsed = yield* parseCsv(encodeCsv(samples))
      expect(parsed).toEqual(samples)
    }))
  it.effect("tolerates CRLF, BOM, unknown columns and missing columns", () =>
    Effect.gen(function*() {
      const parsed = yield* parseCsv("﻿ts,extra,rpm\r\n10,x,900\r\n11,,\r\n")
      expect(parsed).toEqual([{ ts: 10, rpm: 900 }, { ts: 11 }])
    }))
  it.effect("fails on garbage", () =>
    Effect.gen(function*() {
      const err = yield* Effect.flip(parseCsv("ts,rpm\n1,abc\n"))
      expect(err.line).toBe(2)
    }))
})

describe("trip id", () => {
  it("is valid and sortable", () => {
    const id = makeTripId(new Date("2026-11-19T10:20:30.123Z"), "AB12-cd34")
    expect(id).toBe("20261119T102030Z-ab12cd34")
    expect(Schema.is(TripId)(id)).toBe(true)
  })
})

describe("sha256", () => {
  it("matches the known vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})
