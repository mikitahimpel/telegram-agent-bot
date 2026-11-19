import { describe, expect, it } from "vite-plus/test"
import { systemPrompt } from "../src/runner.ts"

describe("system prompt", () => {
  it("asks for plain language, memory tool and the out folder", () => {
    const p = systemPrompt("ru")
    expect(p).toContain("plain everyday language")
    expect(p).toContain("memory_remember")
    expect(p).not.toContain("CLAUDE.md")
    expect(p).toContain("/workspace/out/")
    expect(p).toContain("use Russian")
    expect(systemPrompt("en")).toContain("use English")
  })
})
