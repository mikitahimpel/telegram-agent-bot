import { describe, expect, it } from "@effect/vitest"
import { fuelLphFromMaf, fuelRateSourceFor, parseSupportedMask, parseVoltage, pidByCode, protocolName } from "../src/pids.ts"

const dec = (pid: string, bytes: number[]) => pidByCode(pid)!.decode(bytes)

describe("pid decoders", () => {
  it("decodes known values", () => {
    expect(dec("0C", [0x1a, 0xf8])).toBe(1726) // 6904 / 4
    expect(dec("0D", [0x3c])).toBe(60)
    expect(dec("05", [0x82])).toBe(90)
    expect(dec("0F", [0x41])).toBe(25)
    expect(dec("04", [0xff])).toBe(100)
    expect(dec("11", [0x33])).toBeCloseTo(20)
    expect(dec("10", [0x04, 0xd2])).toBeCloseTo(12.34)
    expect(dec("0B", [101])).toBe(101)
    expect(dec("5E", [0x00, 0x64])).toBe(5)
    expect(dec("2F", [0x80])).toBeCloseTo(50.2, 1)
    expect(dec("42", [0x37, 0x14])).toBeCloseTo(14.1)
  })
  it("parses support masks", () => {
    expect(parseSupportedMask(0, [0xbe, 0x3f, 0xa8, 0x13])).toEqual([
      "01", "03", "04", "05", "06", "07", "0B", "0C", "0D", "0E", "0F", "10", "11", "13", "15", "1C", "1F", "20"
    ])
    expect(parseSupportedMask(0x20, [0x80, 0, 0, 0x01])).toEqual(["21", "40"])
  })
  it("estimates fuel from MAF", () => {
    expect(fuelLphFromMaf(14.7)).toBeCloseTo((1 / 1000 / 0.745) * 3600, 6)
    expect(fuelLphFromMaf(10)).toBeCloseTo(3.29, 1)
  })
  it("picks the fuel source", () => {
    expect(fuelRateSourceFor(["5E", "10"])).toBe("pid_5e")
    expect(fuelRateSourceFor(["10"])).toBe("maf_estimate")
    expect(fuelRateSourceFor(["0C"])).toBe("none")
  })
  it("parses voltage and protocol", () => {
    expect(parseVoltage("12.6V")).toBe(12.6)
    expect(protocolName("A6")).toBe("ISO 15765-4 CAN (11 bit, 500 kbaud)")
  })
})
