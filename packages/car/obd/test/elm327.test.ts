import { describe, expect, it } from "@effect/vitest"
import { cleanReply, findErrorToken, isGarbage, parseMode01, parseVin } from "../src/elm327.ts"

describe("elm327 parsing", () => {
  it("strips echo, spaces and SEARCHING", () => {
    expect(cleanReply("0100\rSEARCHING...\r41 00 BE 3F A8 13 \r\r", "0100")).toEqual(["41 00 BE 3F A8 13"])
    expect(parseMode01(["41 0C 1A F8"], "0C")).toEqual([0x1a, 0xf8])
  })
  it("detects error tokens", () => {
    expect(findErrorToken(["NO DATA"])).toBe("NODATA")
    expect(findErrorToken(["UNABLE TO CONNECT"])).toBe("UNABLETOCONNECT")
    expect(findErrorToken(["BUS INIT: ...ERROR"])).toBeDefined()
    expect(findErrorToken(["BUS INIT: OK", "41 00 00 00 00 00"])).toBeUndefined()
    expect(findErrorToken(["?"])).toBe("?")
    expect(findErrorToken(["CAN ERROR"])).toBe("CANERROR")
    expect(findErrorToken(["BUFFER FULL"])).toBe("BUFFERFULL")
  })
  it("detects garbage", () => {
    expect(isGarbage(["ÿþ?"])).toBe(true)
    expect(isGarbage(["ELM327 v1.5"])).toBe(false)
  })
  it("parses a CAN multi-frame VIN", () => {
    expect(parseVin(["014", "0: 49 02 01 57 50 30", "1: 5A 5A 5A 39 39 5A 54", "2: 53 33 39 32 31 32 34"])).toBe(
      "WP0ZZZ99ZTS392124"
    )
    expect(parseVin(["014", "0:490201575030", "1:5A5A5A39395A54", "2:53333932313234"])).toBe("WP0ZZZ99ZTS392124")
  })
  it("parses a K-line VIN (one frame per line)", () => {
    expect(
      parseVin([
        "49 02 01 00 00 00 57",
        "49 02 02 50 30 5A 5A",
        "49 02 03 5A 39 39 5A",
        "49 02 04 54 53 33 39",
        "49 02 05 32 31 32 34"
      ])
    ).toBe("WP0ZZZ99ZTS392124")
  })
})
