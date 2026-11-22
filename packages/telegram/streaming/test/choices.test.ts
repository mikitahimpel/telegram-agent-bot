import { describe, expect, it } from "vite-plus/test"
import { hideChoiceMarker, splitChoices } from "@bot/core-contracts/choices"

describe("splitChoices", () => {
  it("extracts options and strips the marker line", () => {
    expect(splitChoices("Shall we?\n[[buttons: Yes | No | Later]]")).toEqual({
      text: "Shall we?",
      choices: ["Yes", "No", "Later"]
    })
    expect(splitChoices("Ok [[buttons: A|B]]  \n")).toEqual({ text: "Ok", choices: ["A", "B"] })
  })

  it("leaves malformed markers alone", () => {
    for (const text of [
      "x\n[[buttons: Only one]]",
      "x\n[[buttons: A | B | C | D | E]]",
      "x\n[[buttons: A | ]]",
      `x\n[[buttons: A | ${"b".repeat(25)}]]`,
      "x\n[[buttons: A | B",
      "[[buttons: A | B]] and more text"
    ]) {
      expect(splitChoices(text)).toEqual({ text, choices: [] })
    }
  })
})

describe("hideChoiceMarker", () => {
  it("never shows a half-parsed marker", () => {
    expect(hideChoiceMarker("Hello\n[")).toBe("Hello")
    expect(hideChoiceMarker("Hello\n[[")).toBe("Hello")
    expect(hideChoiceMarker("Hello\n[[butt")).toBe("Hello")
    expect(hideChoiceMarker("Hello\n[[buttons: Yes | N")).toBe("Hello")
    expect(hideChoiceMarker("Hello\n[[buttons: Yes | No]]")).toBe("Hello")
  })

  it("keeps ordinary text", () => {
    expect(hideChoiceMarker("See [link] and [[note]] done")).toBe("See [link] and [[note]] done")
    expect(hideChoiceMarker("[[buttons: A]] tail")).toBe("[[buttons: A]] tail")
  })
})
