import { describe, expect, it } from "@effect/vitest"
import { pickTier } from "../src/model-routing.ts"

describe("pickTier", () => {
  it("keeps everyday chat on the fast model", () => {
    for (const text of [
      "Привет",
      "Как дела?",
      "Что сегодня произошло?",
      "расскажи анекдот",
      "What's the weather tomorrow?"
    ]) {
      expect(pickTier(text, 0)).toBe("fast")
    }
  })

  it("sends heavy tasks to the deep model", () => {
    for (const text of [
      "Помоги с машиной",
      "Нарисуй график расходов по месяцам",
      "Сделай таблицу из этого",
      "Проанализируй мои траты",
      "У меня горит check engine",
      "write a python script",
      "compare these two contracts"
    ]) {
      expect(pickTier(text, 0)).toBe("deep")
    }
  })

  it("goes deep for attachments and long messages", () => {
    expect(pickTier("что тут?", 1)).toBe("deep")
    expect(pickTier("привет ".repeat(100), 0)).toBe("deep")
  })
})
