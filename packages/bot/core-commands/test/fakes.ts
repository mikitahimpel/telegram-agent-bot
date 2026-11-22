import { Effect, Layer } from "effect"
import { makeRegistry } from "@bot/bot-commands/registry"
import { AgentDirectory, type AgentInfo } from "@bot/core-contracts/agent-directory"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { TelegramError } from "@bot/core-contracts/errors"
import { ChatId, sessionKeyOf, TgId, ThreadId, type Role, type SessionKey } from "@bot/core-contracts/ids"
import type { Lang } from "@bot/core-contracts/lang"
import { RunControl } from "@bot/core-contracts/run-control"
import { Sessions, type SessionRecord } from "@bot/core-contracts/sessions"
import { Telegram, type InlineKeyboard } from "@bot/core-contracts/telegram"
import type { CommandContext } from "@bot/core-contracts/commands"
import { coreCallbacks, coreCommands } from "../src/core-commands.ts"
import { HelpRegistry } from "../src/help-registry.ts"

export const adminId = TgId.make(1)
export const aliceId = TgId.make(2)

export type Sent = {
  readonly kind: "send" | "edit"
  readonly threadId: number | undefined
  readonly html: string
  readonly keyboard: InlineKeyboard | undefined
}

export const makeWorld = (
  opts: { topicsEnabled?: boolean; allowed?: ReadonlyArray<TgId>; agents?: ReadonlyArray<AgentInfo> } = {}
) => {
  const sent: Array<Sent> = []
  const answers: Array<{ id: string; text: string | undefined }> = []
  const sessionMap = new Map<string, SessionRecord>()
  const allowed = new Set<number>(opts.allowed ?? [])
  const state = {
    lang: undefined as Lang | undefined,
    stopResult: false,
    killed: [] as Array<number>,
    restarted: [] as Array<number>,
    limits: [] as Array<readonly [number, number | undefined]>,
    stopKeys: [] as Array<string>
  }
  const never = () => Effect.die("unused")

  const telegram = Layer.succeed(Telegram, {
    call: never,
    getFile: never,
    downloadFile: never,
    setMessageReaction: never,
    sendMessage: (to, html, options) => {
      sent.push({ kind: "send", threadId: to.threadId, html, keyboard: options?.keyboard })
      return Effect.succeed({ messageId: 1 })
    },
    editMessageText: (to, html, options) => {
      sent.push({ kind: "edit", threadId: to.threadId, html, keyboard: options?.keyboard })
      return Effect.void
    },
    sendMessageDraft: never,
    sendDocument: never,
    sendChatAction: never,
    createForumTopic: (_chat, _name) =>
      opts.topicsEnabled === false
        ? Effect.fail(
            new TelegramError({ method: "createForumTopic", errorCode: 400, description: "Bad Request: not a forum" })
          )
        : Effect.succeed({ threadId: ThreadId.make(77) }),
    answerCallbackQuery: (id, text) => {
      answers.push({ id, text })
      return Effect.void
    },
    setMyCommands: () => Effect.void
  })

  const sessions = Layer.succeed(Sessions, {
    get: (key) => Effect.succeed(sessionMap.get(key)),
    ensure: (key, threadId, title) => {
      const rec: SessionRecord = {
        key,
        threadId,
        title: title ?? "main",
        claudeSessionId: undefined,
        createdAt: 0,
        lastUsedAt: Date.UTC(2026, 10, 19, 10, 0),
        runs: 3
      }
      sessionMap.set(key, rec)
      return Effect.succeed(rec)
    },
    setClaudeSessionId: () => Effect.void,
    reset: () => Effect.void,
    list: Effect.sync(() => [...sessionMap.values()]),
    checkDailyLimit: Effect.void,
    recordRun: () => Effect.void,
    usage: never(),
    getLang: Effect.sync(() => state.lang),
    setLang: (l) => Effect.sync(() => void (state.lang = l)),
    setDailyLimit: () => Effect.void
  })

  const allowlist = Layer.succeed(Allowlist, {
    adminId,
    roleOf: (id) =>
      Effect.succeed(id === adminId ? ("admin" as const) : allowed.has(id) ? ("user" as const) : undefined),
    allow: (id) => Effect.sync(() => void allowed.add(id)),
    updateProfile: () => Effect.void,
    revoke: (id) => Effect.sync(() => void allowed.delete(id)),
    list: Effect.succeed([])
  })

  const agentList = opts.agents ?? []
  const directory = Layer.succeed(AgentDirectory, {
    list: Effect.succeed(agentList),
    info: (id) => Effect.succeed(agentList.find((a) => a.tgId === id) ?? agentList[0]!),
    kill: (id) => Effect.sync(() => void state.killed.push(id)),
    restart: (id) => Effect.sync(() => void state.restarted.push(id)),
    setLimit: (id, limit) => Effect.sync(() => void state.limits.push([id, limit]))
  })

  const runControl = Layer.succeed(RunControl, {
    stop: (key) => Effect.sync(() => (state.stopKeys.push(key), state.stopResult)),
    stopAll: Effect.succeed(0),
    running: Effect.succeed([])
  })

  const registry = makeRegistry(coreCommands, coreCallbacks)
  const help = Layer.succeed(HelpRegistry, { ...registry, blurbsFor: () => Effect.succeed(["track your car trips"]) })

  return {
    sent,
    answers,
    allowed,
    state,
    registry,
    layer: Layer.mergeAll(telegram, sessions, allowlist, directory, runControl, help)
  }
}

export const ctxOf = (role: Role, args = "", lang: Lang = "en", threadId?: number): CommandContext => {
  const t = threadId === undefined ? undefined : ThreadId.make(threadId)
  return {
    tgId: role === "admin" ? adminId : aliceId,
    chatId: ChatId.make(role === "admin" ? 1 : 2),
    threadId: t,
    sessionKey: sessionKeyOf(t) as SessionKey,
    role,
    lang,
    args,
    messageId: 10
  }
}
