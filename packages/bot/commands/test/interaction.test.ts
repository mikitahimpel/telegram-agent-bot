import { describe, expect, it } from "vite-plus/test"
import {
  choicesKeyboard,
  followUpPrompt,
  isMenuText,
  menuEntry,
  menuKeyboard,
  parseInteraction,
  quickActionsKeyboard,
  MENU_ITEMS,
  QUICK_ACTIONS
} from "../src/interaction.ts"
import { newTopicKeyboard } from "../src/messages.ts"

const data = (kb: ReadonlyArray<ReadonlyArray<{ callbackData?: string }>>) => kb.flat().map((b) => b.callbackData ?? "")

describe("interaction", () => {
  it("keeps every callback data short and parseable", () => {
    const all = [
      ...data(quickActionsKeyboard("ru", "text")),
      ...data(quickActionsKeyboard("ru", "file")),
      ...data(menuKeyboard("en", { car: true })),
      ...data(choicesKeyboard(["a", "b", "c", "d"])),
      "stop:"
    ]
    for (const d of all) {
      expect(d.length).toBeLessThanOrEqual(64)
      expect(parseInteraction(d)).toBeDefined()
    }
    expect(parseInteraction("qa:nope")).toBeUndefined()
    expect(parseInteraction("ch:abc")).toBeUndefined()
    expect(parseInteraction("lang:ru")).toBeUndefined()
  })

  it("uses text actions for answers and file actions for files", () => {
    expect(data(quickActionsKeyboard("en", "text"))).toEqual(["qa:retry", "qa:short", "qa:more", "qa:translate"])
    expect(data(quickActionsKeyboard("en", "file"))).toEqual(["qa:fshort", "qa:fdates", "qa:translate", "qa:fask"])
    expect(quickActionsKeyboard("ru", "text").flat()[0]?.text).toBe("🔄 Ещё раз")
  })

  it("has a localized follow-up prompt for each action that needs one", () => {
    for (const lang of ["ru", "en"] as const) {
      for (const action of QUICK_ACTIONS) {
        const prompt = followUpPrompt(action, lang)
        if (action === "retry" || action === "fask") expect(prompt).toBeUndefined()
        else expect(prompt?.length).toBeGreaterThan(10)
      }
    }
    expect(followUpPrompt("translate", "ru")).toContain("английский")
    expect(followUpPrompt("translate", "en")).toContain("Russian")
  })

  it("lays out choices one per row, or two when all are short", () => {
    expect(choicesKeyboard(["Yes", "No"])).toHaveLength(1)
    expect(choicesKeyboard(["Yes", "No", "Maybe"])).toHaveLength(2)
    expect(choicesKeyboard(["A long option here", "No"])).toHaveLength(2)
    expect(choicesKeyboard(["A long option here", "Another long one", "x"])).toHaveLength(3)
  })

  it("lists the car button only when asked", () => {
    expect(data(menuKeyboard("en", { car: false }))).not.toContain("menu:car")
    expect(data(menuKeyboard("en", { car: true }))).toContain("menu:car")
    for (const item of MENU_ITEMS) expect(menuEntry(item, "ru").text.length).toBeGreaterThan(5)
    expect(menuEntry("remind", "en").kind).toBe("hint")
    expect(menuEntry("news", "en").kind).toBe("prompt")
  })

  it("puts the menu button next to the new-topic button", () => {
    expect(newTopicKeyboard("ru").rows).toEqual([["🆕 Новая тема", "☰ Что умею"]])
    expect(newTopicKeyboard("en").rows).toEqual([["🆕 New topic", "☰ Menu"]])
    expect(isMenuText("☰ Что умею")).toBe(true)
    expect(isMenuText("hello")).toBe(false)
  })
})
