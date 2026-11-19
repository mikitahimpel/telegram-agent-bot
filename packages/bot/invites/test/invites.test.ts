import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { layerMemory as allowlistMemory } from "@bot/bot-allowlist/allowlist"
import { makeRegistry } from "@bot/bot-commands/registry"
import { HelpRegistry } from "@bot/bot-core-commands/help-registry"
import { Allowlist } from "@bot/core-contracts/allowlist"
import type { CommandContext } from "@bot/core-contracts/commands"
import { ChatId, sessionKeyOf, TgId, type Role } from "@bot/core-contracts/ids"
import { Invites } from "@bot/core-contracts/invites"
import { Telegram, type InlineKeyboard } from "@bot/core-contracts/telegram"
import { PluginFlags, layerMemory as flagsMemory } from "@bot/plugins-registry/flags"
import type { User } from "@bot/telegram-schema/schema"
import { makeInviteCommands } from "../src/commands.ts"
import { layer as memoryInvites } from "../src/memory.ts"
import { inviteCodeFromMessage, parseInviteArgs, parseTtl } from "../src/parse.ts"
import { redeemInviteStart } from "../src/redeem-flow.ts"
import { layer as sqliteInvites, type SqlLike } from "../src/sqlite.ts"

const admin = TgId.make(1)
const alice = TgId.make(2)
const bob = TgId.make(3)
const hour = 3_600_000

const nodeSql = (): SqlLike => {
  const db = new DatabaseSync(":memory:")
  return {
    exec: (query, ...bindings) => {
      const stmt = db.prepare(query)
      const rows = /^\s*(select|.*returning)/is.test(query) ? (stmt.all(...bindings) as Array<unknown>) : (stmt.run(...bindings), [])
      return { toArray: () => rows }
    }
  }
}

interface Sent {
  readonly chatId: number
  readonly html: string
  readonly keyboard: InlineKeyboard | undefined
}

const world = (invitesLayer: Layer.Layer<Invites>, now?: { t: number }) => {
  const sent: Array<Sent> = []
  const answers: Array<string | undefined> = []
  const edits: Array<string> = []
  const never = () => Effect.die("unused")
  const telegram = Layer.succeed(Telegram, {
    call: (method) => Effect.succeed(method === "getMe" ? { username: "testbot" } : true),
    sendMessage: (to, html, options) => {
      sent.push({ chatId: to.chatId, html, keyboard: options?.keyboard })
      return Effect.succeed({ messageId: 1 })
    },
    editMessageText: (_to, html) => Effect.sync(() => void edits.push(html)),
    sendMessageDraft: never,
    sendDocument: never,
    sendChatAction: never,
    createForumTopic: never,
    answerCallbackQuery: (_id, text) => Effect.sync(() => void answers.push(text)),
    setMyCommands: () => Effect.void
  })
  const plugins = [{ id: "car", title: { en: "Car", ru: "Авто" }, enabledByDefault: false }]
  const invite = makeInviteCommands(["car"])
  const registry = makeRegistry([...invite.commands], [...invite.callbacks])
  void now
  const layer = Layer.mergeAll(
    telegram,
    allowlistMemory(admin),
    flagsMemory(plugins),
    invitesLayer,
    Layer.succeed(HelpRegistry, registry)
  )
  return { sent, answers, edits, layer, registry, invite }
}

const ctxOf = (role: Role, args = ""): CommandContext => ({
  tgId: role === "admin" ? admin : alice,
  chatId: ChatId.make(role === "admin" ? 1 : 2),
  threadId: undefined,
  sessionKey: sessionKeyOf(undefined),
  role,
  lang: "en",
  args,
  messageId: 5
})

const user = (id: number, extra: Partial<User> = {}): User => ({ id, is_bot: false, first_name: "Masha", ...extra })

describe("option parsing", () => {
  const known = ["car", "notes"]
  it("defaults", () => {
    const r = parseInviteArgs("", known)
    expect(r).toEqual({ ok: true, options: { uses: 1, ttlMs: 7 * 24 * hour, plugins: [], note: undefined } })
  })
  it("any order, quoted and trailing note", () => {
    const r = parseInviteArgs('plugins=car "Маша" uses=3 ttl=24h', known)
    expect(r).toEqual({ ok: true, options: { uses: 3, ttlMs: 24 * hour, plugins: ["car"], note: "Маша" } })
    const rest = parseInviteArgs("ttl=30m uses=2 my friend Bob", known)
    expect(rest).toEqual({ ok: true, options: { uses: 2, ttlMs: 30 * 60_000, plugins: [], note: "my friend Bob" } })
  })
  it("rejects bad values", () => {
    expect(parseInviteArgs("uses=0", known)).toMatchObject({ ok: false, error: { kind: "uses" } })
    expect(parseInviteArgs("uses=101", known)).toMatchObject({ ok: false, error: { kind: "uses" } })
    expect(parseInviteArgs("ttl=91d", known)).toMatchObject({ ok: false, error: { kind: "ttl" } })
    expect(parseInviteArgs("ttl=abc", known)).toMatchObject({ ok: false, error: { kind: "ttl" } })
    expect(parseInviteArgs("plugins=car,zzz", known)).toMatchObject({ ok: false, error: { kind: "plugin", value: "zzz" } })
    expect(parseTtl("90d")).toBe(90 * 24 * hour)
  })
  it("detects invite start messages", () => {
    const msg = (text: string, type = "private") =>
      ({ message_id: 1, date: 0, chat: { id: 5, type }, from: user(5), text }) as never
    expect(inviteCodeFromMessage(msg("/start inv_abcdefghijklmnop"))).toBe("abcdefghijklmnop")
    expect(inviteCodeFromMessage(msg("/start@testbot inv_abcdefghijklmnop"))).toBe("abcdefghijklmnop")
    expect(inviteCodeFromMessage(msg("/start"))).toBeUndefined()
    expect(inviteCodeFromMessage(msg("/start inv_short"))).toBeUndefined()
    expect(inviteCodeFromMessage(msg("hello inv_abcdefghijklmnop"))).toBeUndefined()
    expect(inviteCodeFromMessage(msg("/start inv_abcdefghijklmnop", "group"))).toBeUndefined()
  })
})

describe("SQLite invites", () => {
  const clock = { t: 1_000_000 }
  const make = () => sqliteInvites(nodeSql(), () => clock.t)
  const input = { createdBy: admin, uses: 1, ttlMs: hour, plugins: ["car"], note: "Masha" }

  it.effect("create then redeem", () =>
    Effect.gen(function* () {
      const invites = yield* Invites
      const created = yield* invites.create(input)
      expect(created.code).toMatch(/^[A-Za-z0-9]{24}$/)
      const redeemed = yield* invites.redeem(created.code, alice, { name: "Masha", username: "masha" })
      expect(redeemed.plugins).toEqual(["car"])
      expect(redeemed.createdBy).toBe(admin)
      expect(yield* invites.list).toEqual([])
      const recent = yield* invites.recentRedemptions(10)
      expect(recent[0]).toMatchObject({ tgId: alice, name: "Masha", username: "masha", note: "Masha" })
    }).pipe(Effect.provide(make()))
  )

  it.effect("double redeem concurrently yields exactly one success", () =>
    Effect.gen(function* () {
      const invites = yield* Invites
      const { code } = yield* invites.create(input)
      const results = yield* Effect.all(
        Array.from({ length: 10 }, (_, i) => Effect.result(invites.redeem(code, TgId.make(100 + i)))),
        { concurrency: "unbounded" }
      )
      expect(results.filter((r) => r._tag === "Success")).toHaveLength(1)
      const failures = results.flatMap((r) => (r._tag === "Failure" ? [r.failure] : []))
      expect(failures).toHaveLength(9)
      expect(failures.every((f) => f._tag === "InviteInvalid" && f.reason === "used_up")).toBe(true)
    }).pipe(Effect.provide(make()))
  )

  it.effect("multi-use counts down", () =>
    Effect.gen(function* () {
      const invites = yield* Invites
      const { code } = yield* invites.create({ ...input, uses: 2 })
      yield* invites.redeem(code, alice)
      yield* invites.redeem(code, bob)
      const third = yield* Effect.flip(invites.redeem(code, TgId.make(9)))
      expect(third).toMatchObject({ reason: "used_up" })
    }).pipe(Effect.provide(make()))
  )

  it.effect("expired, revoked, not found", () =>
    Effect.gen(function* () {
      const invites = yield* Invites
      const a = yield* invites.create(input)
      const b = yield* invites.create(input)
      expect(yield* invites.revoke(b.code)).toBe(true)
      expect(yield* invites.revoke(b.code)).toBe(false)
      expect(yield* Effect.flip(invites.redeem(b.code, alice))).toMatchObject({ reason: "revoked" })
      expect(yield* Effect.flip(invites.redeem("x".repeat(24), alice))).toMatchObject({ reason: "not_found" })
      clock.t += 2 * hour
      expect(yield* Effect.flip(invites.redeem(a.code, alice))).toMatchObject({ reason: "expired" })
    }).pipe(Effect.provide(make()))
  )

  it.effect("rate limits failed redemptions per user", () =>
    Effect.gen(function* () {
      const invites = yield* Invites
      for (let i = 0; i < 5; i++) {
        expect(yield* Effect.flip(invites.redeem("y".repeat(24), bob))).toMatchObject({ reason: "not_found" })
      }
      expect(yield* Effect.flip(invites.redeem("y".repeat(24), bob))).toMatchObject({ reason: "rate_limited" })
      const { code } = yield* invites.create(input)
      expect(yield* Effect.flip(invites.redeem(code, bob))).toMatchObject({ reason: "rate_limited" })
      yield* invites.redeem(code, alice)
    }).pipe(Effect.provide(make()))
  )
})

describe("commands", () => {
  it.effect("/invite replies with link, summary and revoke button; /invites lists and callback revokes", () => {
    const w = world(memoryInvites())
    return Effect.gen(function* () {
      const invite = w.registry.find("invite", "admin")!
      yield* invite.handler(ctxOf("admin", 'plugins=car uses=2 "Маша <b>"'))
      const first = w.sent[0]!
      expect(first.html).toMatch(/https:\/\/t\.me\/testbot\?start=inv_[A-Za-z0-9]{24}/)
      expect(first.html).toContain("Маша &lt;b&gt;")
      expect(first.keyboard?.[0]?.[0]).toMatchObject({ style: "danger" })
      const data = first.keyboard![0]![0]!.callbackData!
      expect(data.startsWith("invrev:")).toBe(true)

      yield* w.registry.find("invites", "admin")!.handler(ctxOf("admin"))
      expect(w.sent[1]!.html).toContain("Active invites")
      expect(w.sent[1]!.keyboard).toHaveLength(1)

      const found = w.registry.findCallback(data, "admin")!
      yield* found.def.handler({ ...ctxOf("admin"), payload: found.payload, callbackId: "cb" })
      expect(w.answers).toEqual(["Invite revoked."])
      yield* w.registry.find("invites", "admin")!.handler(ctxOf("admin"))
      expect(w.sent[2]!.html).toContain("No active invites.")
    }).pipe(Effect.provide(w.layer))
  })

  it.effect("usage on errors", () => {
    const w = world(memoryInvites())
    return Effect.gen(function* () {
      yield* w.registry.find("invite", "admin")!.handler(ctxOf("admin", "plugins=nope"))
      expect(w.sent[0]!.html).toContain("Unknown plugin")
      expect(w.sent[0]!.html).toContain("Usage:")
    }).pipe(Effect.provide(w.layer))
  })

  it("is invisible to users and visible to admin", () => {
    const w = world(memoryInvites())
    expect(w.registry.find("invite", "user")).toBeUndefined()
    expect(w.registry.find("invites", "user")).toBeUndefined()
    expect(w.registry.findCallback("invrev:abc", "user")).toBeUndefined()
    expect(w.registry.visibleFor("user").map((c) => c.name)).not.toContain("invite")
    expect(w.registry.visibleFor("admin").map((c) => c.name)).toEqual(expect.arrayContaining(["invite", "invites"]))
  })
})

describe("redeem flow", () => {
  const setup = () => {
    const w = world(memoryInvites())
    return w
  }

  it.effect("redeems, allowlists, sets flags, welcomes and notifies the admin", () => {
    const w = setup()
    return Effect.gen(function* () {
      const invites = yield* Invites
      const { code } = yield* invites.create({ createdBy: admin, uses: 1, ttlMs: hour, plugins: ["car"], note: "Masha" })
      yield* redeemInviteStart({ from: user(alice, { username: "masha", language_code: "ru" }), code, adminLang: "en" })
      const allowlist = yield* Allowlist
      expect(yield* allowlist.roleOf(alice)).toBe("user")
      const entry = (yield* allowlist.list).find((e) => e.tgId === alice)!
      expect(entry).toMatchObject({ name: "Masha", username: "masha", invitedVia: code, addedBy: admin })
      expect(yield* (yield* PluginFlags).isEnabled("car", alice)).toBe(true)
      const toUser = w.sent.find((s) => s.chatId === alice)!
      expect(toUser.html).toContain("Добро пожаловать")
      const toAdmin = w.sent.find((s) => s.chatId === admin)!
      expect(toAdmin.html).toContain("Masha (@masha, <code>2</code>) joined via invite «Masha»")
      expect(toAdmin.keyboard?.[0]?.[0]).toMatchObject({ callbackData: "revask:2", style: "danger" })
      yield* redeemInviteStart({ from: user(alice), code, adminLang: "en" })
      expect(w.sent.at(-1)!.html).toBe("You already have access to this bot.")
      expect((yield* invites.list).length).toBe(0)
    }).pipe(Effect.provide(w.layer))
  })

  it.effect("already allowed and admin do not consume the invite", () => {
    const w = setup()
    return Effect.gen(function* () {
      const invites = yield* Invites
      const allowlist = yield* Allowlist
      yield* allowlist.allow(bob, admin)
      const { code } = yield* invites.create({ createdBy: admin, uses: 1, ttlMs: hour, plugins: [], note: undefined })
      yield* redeemInviteStart({ from: user(bob), code, adminLang: "en" })
      yield* redeemInviteStart({ from: user(admin), code, adminLang: "en" })
      expect(w.sent[0]!.html).toContain("already have access")
      expect(w.sent[1]!.html).toContain("your own invite")
      expect((yield* invites.list)[0]?.usesLeft).toBe(1)
    }).pipe(Effect.provide(w.layer))
  })

  it.effect("specific failure reasons, then silence after the limit", () => {
    const w = setup()
    return Effect.gen(function* () {
      const invites = yield* Invites
      const used = yield* invites.create({ createdBy: admin, uses: 1, ttlMs: hour, plugins: [], note: undefined })
      const revoked = yield* invites.create({ createdBy: admin, uses: 1, ttlMs: hour, plugins: [], note: undefined })
      const expired = yield* invites.create({ createdBy: admin, uses: 1, ttlMs: -1000, plugins: [], note: undefined })
      yield* invites.redeem(used.code, bob)
      yield* invites.revoke(revoked.code)
      const from = user(alice)
      for (const code of [used.code, revoked.code, expired.code, "z".repeat(24)]) {
        yield* redeemInviteStart({ from, code, adminLang: "en" })
      }
      expect(w.sent.map((s) => s.html)).toEqual([
        "This invite link has already been used.",
        "This invite link was revoked.",
        "This invite link has expired. Ask for a new one.",
        "This invite link is invalid."
      ])
      yield* redeemInviteStart({ from, code: "z".repeat(24), adminLang: "en" })
      yield* redeemInviteStart({ from, code: "q".repeat(24), adminLang: "en" })
      expect(w.sent).toHaveLength(5)
      expect(yield* (yield* Allowlist).roleOf(alice)).toBeUndefined()
    }).pipe(Effect.provide(w.layer))
  })
})
