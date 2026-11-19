import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { renderHelp } from "@bot/bot-commands/help"
import { adminId, aliceId, ctxOf, makeWorld } from "./fakes.ts"
import { coreCallbacks, coreCommands } from "../src/core-commands.ts"

const runCmd = (w: ReturnType<typeof makeWorld>, name: string, role: "admin" | "user", args = "", lang: "ru" | "en" = "en") => {
  const def = w.registry.find(name, role)
  if (def === undefined) return Effect.die(`unknown ${name}`)
  return def.handler(ctxOf(role, args, lang)).pipe(Effect.provide(w.layer))
}
const runCb = (w: ReturnType<typeof makeWorld>, data: string, role: "admin" | "user", lang: "ru" | "en" = "en") => {
  const found = w.registry.findCallback(data, role)
  if (found === undefined) return Effect.die(`no callback ${data}`)
  const { args: _a, ...ctx } = ctxOf(role, "", lang)
  return found.def.handler({ ...ctx, payload: found.payload, callbackId: "cb1" }).pipe(Effect.provide(w.layer))
}

describe("role visibility", () => {
  it("admin commands are invisible to users", () => {
    const w = makeWorld()
    for (const n of ["agents", "usage", "allow", "revoke", "kill", "restart"]) {
      expect(w.registry.find(n, "user")).toBeUndefined()
      expect(w.registry.find(n, "admin")).toBeDefined()
    }
    expect(w.registry.visibleFor("user").map((c) => c.name)).toEqual(["start", "help", "new", "sessions", "stop", "lang"])
    expect(w.registry.findCallback("kill:5", "user")).toBeUndefined()
    expect(w.registry.findCallback("lang:ru", "user")).toBeDefined()
    expect(coreCommands.length).toBe(12)
    expect(coreCallbacks.length).toBe(5)
  })
})

describe("/start and /help", () => {
  it.effect("start tells admin they are admin", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "start", "admin")
      yield* runCmd(w, "start", "user")
      expect(w.sent[0]?.html).toContain("admin")
      expect(w.sent[0]?.html).toContain("/lang")
      expect(w.sent[1]?.html).not.toContain("admin")
    })
  })

  it.effect("help differs by role", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "help", "admin")
      yield* runCmd(w, "help", "user")
      expect(w.sent[0]?.html).toBe(renderHelp(w.registry, "admin", "en"))
      expect(w.sent[0]?.html).toContain("/allow &lt;tgId&gt;")
      expect(w.sent[1]?.html).not.toContain("/allow")
      expect(w.sent[1]?.html).not.toContain("admin")
    })
  })
})

describe("/new, /sessions, /stop", () => {
  it.effect("creates topic, ensures session, replies inside topic", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "new", "user", "My <chat>")
      yield* runCmd(w, "sessions", "user")
      expect(w.sent[0]?.threadId).toBe(77)
      expect(w.sent[0]?.html).toContain("My &lt;chat&gt;")
      expect(w.sent[1]?.html).toContain("My &lt;chat&gt;")
      expect(w.sent[1]?.html).toContain("3 runs")
      expect(w.sent[1]?.html).toContain("Nov 19, 10:00 UTC")
    })
  })

  it.effect("explains when topics are disabled", () => {
    const w = makeWorld({ topicsEnabled: false })
    return Effect.gen(function* () {
      yield* runCmd(w, "new", "user")
      expect(w.sent).toHaveLength(1)
      expect(w.sent[0]?.html).toContain("BotFather")
      expect(w.sent[0]?.threadId).toBeUndefined()
    })
  })

  it.effect("/stop reports result", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "stop", "user")
      w.state.stopResult = true
      yield* runCmd(w, "stop", "user")
      expect(w.state.stopKeys).toEqual(["main", "main"])
      expect(w.sent[0]?.html).toContain("Nothing")
      expect(w.sent[1]?.html).toBe("Stopped.")
    })
  })
})

describe("/lang", () => {
  it.effect("no arg shows buttons; callback switches language", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "lang", "user")
      expect(w.sent[0]?.keyboard?.[0]?.map((b) => b.callbackData)).toEqual(["lang:ru", "lang:en"])
      yield* runCb(w, "lang:ru", "user")
      expect(w.state.lang).toBe("ru")
      expect(w.answers).toEqual([{ id: "cb1", text: "Язык переключён на русский." }])
      expect(w.sent[1]?.kind).toBe("edit")
    })
  })

  it.effect("arg switches and confirms in the new language; bad arg shows usage", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "lang", "user", "ru")
      yield* runCmd(w, "lang", "user", "xx")
      expect(w.state.lang).toBe("ru")
      expect(w.sent[0]?.html).toBe("Язык переключён на русский.")
      expect(w.sent[1]?.html).toContain("/lang [ru|en]")
    })
  })
})

describe("admin flows", () => {
  it.effect("/allow validates, grants, and is idempotent", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "allow", "admin", "abc")
      expect(w.sent[0]?.html).toContain("Usage")
      yield* runCmd(w, "allow", "admin", String(aliceId))
      expect(w.allowed.has(aliceId)).toBe(true)
      yield* runCmd(w, "allow", "admin", String(aliceId), "ru")
      expect(w.sent[2]?.html).toContain("уже есть доступ")
    })
  })

  it.effect("/revoke asks for confirmation, callback revokes", () => {
    const w = makeWorld({ allowed: [aliceId] })
    return Effect.gen(function* () {
      yield* runCmd(w, "revoke", "admin", String(aliceId))
      const kb = w.sent[0]?.keyboard?.[0]
      expect(kb?.[0]).toMatchObject({ callbackData: `revoke:${aliceId}`, style: "danger" })
      expect(kb?.[1]).toMatchObject({ callbackData: "cancel:", style: "primary" })
      expect(w.allowed.has(aliceId)).toBe(true)
      yield* runCb(w, `revoke:${aliceId}`, "admin")
      expect(w.allowed.has(aliceId)).toBe(false)
      expect(w.answers).toHaveLength(1)
      expect(w.sent[1]).toMatchObject({ kind: "edit" })
      expect(w.sent[1]?.html).toContain("revoked")
    })
  })

  it.effect("cancel edits message without changes; revoke of admin refused", () => {
    const w = makeWorld({ allowed: [aliceId] })
    return Effect.gen(function* () {
      yield* runCb(w, "cancel:", "admin")
      expect(w.allowed.has(aliceId)).toBe(true)
      expect(w.sent[0]?.html).toBe("Cancelled.")
      yield* runCmd(w, "revoke", "admin", String(adminId))
      expect(w.sent[1]?.html).toContain("cannot be revoked")
    })
  })

  it.effect("callback handlers re-check role", () => {
    const w = makeWorld({ allowed: [aliceId] })
    const found = w.registry.findCallback(`revoke:${aliceId}`, "admin")!
    const { args: _a, ...ctx } = ctxOf("user")
    return Effect.gen(function* () {
      yield* found.def.handler({ ...ctx, payload: found.payload, callbackId: "x" }).pipe(Effect.provide(w.layer))
      expect(w.allowed.has(aliceId)).toBe(true)
      expect(w.answers).toEqual([{ id: "x", text: undefined }])
      expect(w.sent).toHaveLength(0)
    })
  })

  it.effect("/kill confirm then kill; /restart direct", () => {
    const w = makeWorld()
    return Effect.gen(function* () {
      yield* runCmd(w, "kill", "admin", "5")
      expect(w.sent[0]?.keyboard?.[0]?.[0]?.callbackData).toBe("kill:5")
      expect(w.state.killed).toEqual([])
      yield* runCb(w, "kill:5", "admin")
      expect(w.state.killed).toEqual([5])
      yield* runCmd(w, "restart", "admin", "5")
      expect(w.state.restarted).toEqual([5])
      yield* runCmd(w, "kill", "admin", "-1")
      expect(w.sent.at(-1)?.html).toContain("Usage")
    })
  })

  it.effect("/agents and /usage render", () => {
    const usage = { runsToday: 2, dailyLimit: 50, runsTotal: 9, costUsdTotal: 1.234, inputTokensTotal: 100, outputTokensTotal: 200, lastRunAt: undefined }
    const w = makeWorld({ agents: [{ tgId: aliceId, sessions: 2, running: 1, usage }] })
    return Effect.gen(function* () {
      yield* runCmd(w, "agents", "admin")
      yield* runCmd(w, "usage", "admin")
      yield* runCmd(w, "usage", "admin", "2")
      expect(w.sent[0]?.html).toMatch(/^<pre>/)
      expect(w.sent[0]?.html).toContain("$1.23")
      expect(w.sent[1]?.html).toContain("100/200")
      expect(w.sent[2]?.html).toContain("2/50")
      expect(w.sent[2]?.html).toContain("never")
    })
  })
})
