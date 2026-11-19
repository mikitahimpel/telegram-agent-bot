import { describe, expect, it } from "vite-plus/test"
import { humanStatus, statusKindOf } from "../src/status-labels.ts"

describe("human status labels", () => {
  it.each([
    ["WebSearch", "search"],
    ["WebFetch", "fetch"],
    ["Read", "readFile"],
    ["Grep", "readFile"],
    ["Write", "writeFile"],
    ["Edit", "writeFile"],
    ["Bash", "compute"],
    ["mcp__bot__car_list_trips", "car"],
    ["mcp__bot__reminder_create", "reminder"],
    ["mcp__bot__schedule_reminder", "reminder"],
    ["Task", "thinking"],
    ["mcp__bot__other", "thinking"]
  ])("%s maps to %s", (name, kind) => {
    expect(statusKindOf(name)).toBe(kind)
  })

  it("is localized", () => {
    expect(humanStatus("WebSearch", "ru")).toBe("Ищу в интернете…")
    expect(humanStatus("WebFetch", "ru")).toBe("Читаю страницу…")
    expect(humanStatus("Read", "ru")).toBe("Читаю файл…")
    expect(humanStatus("Write", "ru")).toBe("Готовлю файл…")
    expect(humanStatus("Bash", "ru")).toBe("Считаю…")
    expect(humanStatus("mcp__bot__car_query", "ru")).toBe("Смотрю данные машины…")
    expect(humanStatus("mcp__bot__reminder_set", "ru")).toBe("Ставлю напоминание…")
    expect(humanStatus("Whatever", "ru")).toBe("Думаю…")
    expect(humanStatus("WebSearch", "en")).toBe("Searching the web…")
  })
})
