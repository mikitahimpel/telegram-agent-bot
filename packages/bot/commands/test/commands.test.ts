import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { CallbackDef, CommandDef } from "@bot/core-contracts/commands"
import {
  AgentBusy,
  ContainerDown,
  DailyLimitReached,
  StorageError,
  SubscriptionLimitReached,
  Unauthorized
} from "@bot/core-contracts/errors"
import { ChatId, TgId } from "@bot/core-contracts/ids"
import { renderHelp } from "../src/help.ts"
import { errorMessage, formatClock, formatDateTime, isNewTopicText, messages } from "../src/messages.ts"
import { makeRegistry } from "../src/registry.ts"

const cmd = (name: string, role: "user" | "admin", extra: Partial<CommandDef> = {}): CommandDef => ({
  name,
  role,
  description: { en: `${name} does <things>`, ru: `${name} делает вещи` },
  handler: () => Effect.void,
  ...extra
})
const cb = (prefix: string, role: "user" | "admin"): CallbackDef => ({ prefix, role, handler: () => Effect.void })

const registry = makeRegistry(
  [
    cmd("start", "user"),
    cmd("kill", "admin", { usage: { en: "<tgId>", ru: "<tgId>" } }),
    cmd("lang", "user", { usage: { en: "[ru|en]", ru: "[ru|en]" } }),
    cmd("secret", "user", { hidden: true }),
    cmd("allow", "admin")
  ],
  [cb("lang", "user"), cb("kill", "admin")]
)

describe("registry", () => {
  it("find hides admin commands from users", () => {
    expect(registry.find("kill", "user")).toBeUndefined()
    expect(registry.find("kill", "admin")?.name).toBe("kill")
    expect(registry.find("/START@my_bot", "user")?.name).toBe("start")
    expect(registry.find("nope", "admin")).toBeUndefined()
    expect(registry.find("secret", "user")?.name).toBe("secret")
  })

  it("findCallback checks role and splits payload", () => {
    expect(registry.findCallback("kill:42", "user")).toBeUndefined()
    const found = registry.findCallback("kill:42:x", "admin")
    expect(found?.payload).toBe("42:x")
    expect(registry.findCallback("lang:ru", "user")?.payload).toBe("ru")
    expect(registry.findCallback("cancel:", "admin")).toBeUndefined()
  })

  it("visibleFor excludes hidden and admin commands for users", () => {
    expect(registry.visibleFor("user").map((c) => c.name)).toEqual(["start", "lang"])
    expect(registry.visibleFor("admin").map((c) => c.name)).toEqual(["start", "lang", "kill", "allow"])
  })

  it("menus: default + admin chat scope, en and ru", () => {
    const menus = registry.menus(ChatId.make(7))
    expect(menus.map((m) => [m.scope.type, m.languageCode])).toEqual([
      ["default", undefined],
      ["default", "ru"],
      ["chat", undefined],
      ["chat", "ru"]
    ])
    expect(menus[0]?.commands.map((c) => c.command)).toEqual(["start", "lang"])
    expect(menus[3]?.commands.map((c) => c.command)).toEqual(["start", "lang", "kill", "allow"])
    expect(menus[1]?.commands[0]?.description).toBe("start делает вещи")
    for (const m of menus)
      for (const c of m.commands) {
        expect(c.description.length).toBeGreaterThanOrEqual(3)
        expect(c.description.length).toBeLessThanOrEqual(256)
      }
  })

  it("clamps descriptions", () => {
    const r = makeRegistry([cmd("a", "user", { description: { en: "x", ru: "y".repeat(300) } })], [])
    const [en, ru] = r.menus(ChatId.make(1))
    expect(en?.commands[0]?.description).toBe("x..")
    expect(ru?.commands[0]?.description).toHaveLength(256)
  })

  it("rejects duplicates", () => {
    expect(() => makeRegistry([cmd("a", "user"), cmd("a", "admin")], [])).toThrow()
  })
})

describe("renderHelp", () => {
  it("differs by role and escapes HTML", () => {
    const user = renderHelp(registry, "user", "en")
    const admin = renderHelp(registry, "admin", "en")
    expect(user).not.toContain("admin")
    expect(user).not.toContain("/kill")
    expect(user).toContain("/lang [ru|en]")
    expect(user).toContain("does &lt;things&gt;")
    expect(admin).toContain("You are the <b>admin</b>")
    expect(admin).toContain("<b>Admin commands</b>")
    expect(admin).toContain("/kill &lt;tgId&gt;")
    expect(renderHelp(registry, "admin", "ru")).toContain("администратор")
  })
})

describe("messages", () => {
  it("formats reset time per language", () => {
    const ms = Date.UTC(2026, 10, 19, 14, 5)
    expect(formatDateTime(ms, "en")).toBe("Nov 19, 14:05 UTC")
    expect(formatDateTime(ms, "ru")).toBe("19 ноя, 14:05 UTC")
    expect(messages.ru.subscriptionLimit(ms)).toContain("19 ноя, 14:05 UTC")
  })

  it("errorMessage maps errors, silent on Unauthorized", () => {
    expect(errorMessage(new Unauthorized({ tgId: TgId.make(1) }), "en")).toBeUndefined()
    expect(errorMessage(new AgentBusy({ sessionKey: "main" }), "en")).toBe(messages.en.busy)
    expect(errorMessage(new DailyLimitReached({ limit: 50 }), "ru")).toContain("50")
    expect(errorMessage(new SubscriptionLimitReached({}), "en")).toBe(messages.en.subscriptionLimit(undefined))
    expect(errorMessage(new ContainerDown({ reason: "secret detail" }), "en")).not.toContain("secret")
    expect(errorMessage(new StorageError({ operation: "x" }), "ru")).toBe(messages.ru.genericError)
  })
})

describe("minimal user menu", () => {
  const r = makeRegistry(
    [
      cmd("start", "user"),
      cmd("help", "user"),
      cmd("lang", "user"),
      cmd("stop", "user", { advanced: true }),
      cmd("new", "admin"),
      cmd("sessions", "admin")
    ],
    []
  )

  it("default scope has only start, help, lang; admin chat scope has everything", () => {
    const menus = r.menus(ChatId.make(7))
    expect(menus[0]?.commands.map((c) => c.command)).toEqual(["start", "help", "lang"])
    expect(menus[1]?.commands.map((c) => c.command)).toEqual(["start", "help", "lang"])
    expect(menus[2]?.commands.map((c) => c.command)).toEqual(["start", "help", "lang", "stop", "new", "sessions"])
    expect(r.find("stop", "user")).toBeDefined()
    expect(r.find("new", "user")).toBeUndefined()
  })
})

describe("clock and button helpers", () => {
  it("formats the reset time in UTC, with the date only when it is another day", () => {
    const now = Date.UTC(2026, 10, 19, 10, 0)
    expect(formatClock(Date.UTC(2026, 10, 19, 14, 5), now, "ru")).toBe("14:05 UTC")
    expect(formatClock(Date.UTC(2026, 10, 20, 1, 30), now, "ru")).toBe("20 ноя в 01:30 UTC")
    expect(formatClock(Date.UTC(2026, 10, 20, 1, 30), now, "en")).toBe("Nov 20 at 01:30 UTC")
    expect(formatClock(Date.UTC(2026, 10, 19, 14, 5), now, "ru", "Europe/Warsaw")).toBe("15:05")
    expect(formatClock(Date.UTC(2026, 10, 19, 23, 30), now, "en", "Europe/Warsaw")).toBe("Nov 20 at 00:30")
    expect(formatClock(Date.UTC(2026, 10, 19, 14, 5), now, "ru", "Not/AZone")).toBe("14:05 UTC")
  })

  it("recognises the new topic button in both languages", () => {
    expect(isNewTopicText("🆕 Новая тема")).toBe(true)
    expect(isNewTopicText("🆕 New topic")).toBe(true)
    expect(isNewTopicText("new topic")).toBe(false)
  })
})
