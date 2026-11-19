import { describe, expect, it } from "@effect/vitest"
import { makeEngineDetector } from "../src/engine-detector.ts"

describe("engine detector", () => {
  it("starts only after rpm stays above 300 for 3 s", () => {
    const d = makeEngineDetector()
    expect(d.observe(0, 250)).toBe("none")
    expect(d.observe(500, 900)).toBe("none")
    expect(d.observe(2500, 900)).toBe("none")
    expect(d.observe(3400, 900)).toBe("none")
    expect(d.observe(3500, 900)).toBe("started")
    expect(d.running()).toBe(true)
  })

  it("a dip below the threshold restarts the start timer", () => {
    const d = makeEngineDetector()
    d.observe(0, 900)
    d.observe(2000, 900)
    expect(d.observe(2500, 100)).toBe("none")
    expect(d.observe(3000, 900)).toBe("none")
    expect(d.observe(5900, 900)).toBe("none")
    expect(d.observe(6000, 900)).toBe("started")
  })

  it("silent ECU never starts", () => {
    const d = makeEngineDetector()
    for (let t = 0; t < 20_000; t += 500) expect(d.observe(t, undefined)).toBe("none")
  })

  it("stops after 60 s of rpm 0 or silence, and any running reading resets the timer", () => {
    const d = makeEngineDetector()
    d.adoptRunning(0)
    expect(d.observe(0, 0)).toBe("none")
    expect(d.observe(59_000, 0)).toBe("none")
    expect(d.observe(59_500, 1200)).toBe("none")
    expect(d.observe(100_000, undefined)).toBe("none")
    expect(d.observe(159_999, undefined)).toBe("none")
    expect(d.observe(160_000, undefined)).toBe("stopped")
    expect(d.running()).toBe(false)
  })
})
