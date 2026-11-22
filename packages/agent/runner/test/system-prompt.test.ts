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

describe("choice buttons instruction", () => {
  it("is part of the system prompt with its limits", async () => {
    const { choiceButtonsPrompt } = await import("../src/runner.ts")
    expect(systemPrompt("en")).toContain(choiceButtonsPrompt)
    expect(choiceButtonsPrompt).toContain("[[buttons: Option 1 | Option 2 | Option 3]]")
    expect(choiceButtonsPrompt).toContain("2 to 4 options")
    expect(choiceButtonsPrompt).toContain("24 characters")
  })
})
