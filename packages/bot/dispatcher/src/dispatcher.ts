import { Cause, Effect, Ref, Stream } from "effect"
import { errorMessage } from "@bot/bot-commands/messages"
import type { Registry } from "@bot/bot-commands/registry"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { AgentRunner } from "@bot/core-contracts/agent-runner"
import type { AgentEvent } from "@bot/core-contracts/agent-event"
import type { CommandContext } from "@bot/core-contracts/commands"
import type { BotError } from "@bot/core-contracts/errors"
import { ChatId, ClaudeSessionId, sessionKeyOf, TgId, ThreadId, type Role, type SessionKey } from "@bot/core-contracts/ids"
import { langFromTelegram, type Lang } from "@bot/core-contracts/lang"
import { RunControl } from "@bot/core-contracts/run-control"
import { Sessions } from "@bot/core-contracts/sessions"
import { Telegram, type SendTarget } from "@bot/core-contracts/telegram"
import { parseCommand } from "@bot/telegram-schema/command"
import type { CallbackQuery, Message, Update } from "@bot/telegram-schema/schema"
import { messages } from "@bot/bot-commands/messages"
import { AdminNotifier } from "./admin-notifier.ts"
import { McpAccess } from "./mcp-access.ts"
import { RunSlots } from "./run-control.ts"

/**
 * Shows a run to the user (drafts, final message). Supplied by the caller (gateway wires
 * `presentRun` from @bot/telegram-streaming) so the dispatcher stays independent of it.
 */
export type PresentRun = (args: {
  readonly to: SendTarget
  readonly lang: Lang
  readonly stream: Stream.Stream<AgentEvent, BotError>
}) => Effect.Effect<void, BotError, Telegram>

export interface DispatcherOptions<R> {
  readonly registry: Registry<R>
  readonly present: PresentRun
  /** Bot username used to ignore `/cmd@otherbot`. */
  readonly botUsername?: string
}

export type DispatchRequirements<R> =
  | R
  | Allowlist
  | Sessions
  | Telegram
  | AgentRunner
  | RunControl
  | RunSlots
  | AdminNotifier
  | McpAccess

/** Errors that are expected user-facing situations; everything else is also reported to the admin. */
const isExpected = (e: BotError): boolean =>
  e._tag === "Unauthorized" ||
  e._tag === "AgentBusy" ||
  e._tag === "DailyLimitReached" ||
  e._tag === "SubscriptionLimitReached" ||
  e._tag === "RunInterrupted"

const isBotError = (u: unknown): u is BotError =>
  typeof u === "object" && u !== null && "_tag" in u && typeof (u as { _tag: unknown })._tag === "string"

const targetOf = (chatId: ChatId, threadId: ThreadId | undefined): SendTarget =>
  threadId === undefined ? { chatId } : { chatId, threadId }

interface Origin {
  readonly tgId: TgId
  readonly chatId: ChatId
  readonly threadId: ThreadId | undefined
  readonly languageCode: string | undefined
}

export const makeDispatcher = <R>(options: DispatcherOptions<R>) => {
  const { registry, present } = options

  /** Last line of defense: show a localized error, report unexpected ones to the admin, never fail. */
  const guard = <A, E, Rx>(origin: Origin | undefined, lang: Lang, effect: Effect.Effect<A, E, Rx>) =>
    effect.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (Cause.hasInterruptsOnly(cause)) return
          const tg = yield* Telegram
          const notifier = yield* AdminNotifier
          const failure = cause.reasons.flatMap((r) => (r._tag === "Fail" ? [r.error] : []))[0]
          const err = isBotError(failure) ? failure : undefined
          const text = err === undefined ? messages[lang].genericError : errorMessage(err, lang)
          if (text !== undefined && origin !== undefined) {
            yield* tg.sendMessage(targetOf(origin.chatId, origin.threadId), text).pipe(Effect.ignore)
          }
          if (err === undefined || !isExpected(err)) {
            const label = err === undefined ? Cause.pretty(cause) : `${err._tag}: ${JSON.stringify(err)}`
            yield* notifier.notify(`Error for user ${origin?.tgId ?? "?"}: ${label}`)
          }
        })
      )
    )

  const handleMessage = (message: Message, role: Role, lang: Lang, origin: Origin) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const tg = yield* Telegram
      const threadId = origin.threadId
      const sessionKey = sessionKeyOf(threadId)
      const text = message.text ?? message.caption
      if (text === undefined || text.trim() === "") return
      const parsed = parseCommand(message, options.botUsername)
      if (parsed !== undefined) {
        const def = registry.find(parsed.name, role)
        if (def === undefined) {
          yield* tg.sendMessage(targetOf(origin.chatId, threadId), messages[lang].unknownCommand)
          return
        }
        const ctx: CommandContext = {
          tgId: origin.tgId,
          chatId: origin.chatId,
          threadId,
          sessionKey,
          role,
          lang,
          args: parsed.args,
          messageId: message.message_id
        }
        yield* def.handler(ctx).pipe(Effect.withSpan("dispatch.command", { attributes: { command: parsed.name } }))
        return
      }
      yield* sessions.ensure(sessionKey, threadId)
      yield* runPrompt(origin, sessionKey, lang, text)
    })

  const runPrompt = (origin: Origin, sessionKey: SessionKey, lang: Lang, prompt: string) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const runner = yield* AgentRunner
      const slots = yield* RunSlots
      const tg = yield* Telegram
      const mcpAccess = yield* McpAccess
      const to = targetOf(origin.chatId, origin.threadId)

      yield* sessions.checkDailyLimit
      const record = yield* sessions.ensure(sessionKey, origin.threadId)
      const mcp = yield* mcpAccess.issue(origin.tgId)

      const files = yield* Ref.make<ReadonlyArray<{ readonly path: string; readonly fileName: string }>>([])
      const completed = yield* Ref.make(false)

      const tap = (event: AgentEvent): Effect.Effect<void, BotError> => {
        switch (event._tag) {
          case "SessionStarted":
            return sessions.setClaudeSessionId(sessionKey, ClaudeSessionId.make(event.sessionId))
          case "FileProduced":
            return Ref.update(files, (xs) => [...xs, { path: event.path, fileName: event.fileName }])
          case "Completed":
            return Ref.set(completed, true).pipe(
              Effect.andThen(sessions.setClaudeSessionId(sessionKey, event.sessionId)),
              Effect.andThen(
                sessions.recordRun({
                  sessionKey,
                  costUsd: event.costUsd,
                  inputTokens: event.inputTokens,
                  outputTokens: event.outputTokens,
                  durationMs: event.durationMs,
                  isError: event.isError
                })
              )
            )
          default:
            return Effect.void
        }
      }

      const stream = runner
        .run({ tgId: origin.tgId, sessionKey, resume: record.claudeSessionId, prompt, lang, mcp })
        .pipe(Stream.tap(tap))

      const execute = present({ to, lang, stream }).pipe(
        // A run that ended without a result (crash, stop, limit) still counts towards the daily quota.
        Effect.onExit(() =>
          Effect.gen(function* () {
            if (yield* Ref.get(completed)) return
            yield* sessions
              .recordRun({ sessionKey, costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, isError: true })
              .pipe(Effect.ignore)
          })
        ),
        Effect.withSpan("dispatch.agent-run", { attributes: { tgId: origin.tgId, sessionKey } })
      )

      yield* slots.runExclusive(sessionKey, execute)

      const produced = yield* Ref.get(files)
      for (const file of produced) {
        yield* runner.readFile(origin.tgId, file.path).pipe(
          Effect.flatMap((bytes) => tg.sendDocument(to, { fileName: file.fileName, bytes })),
          Effect.catch((e) => guard(origin, lang, Effect.fail(e)))
        )
      }
    })

  const handleCallback = (query: CallbackQuery, role: Role, lang: Lang, origin: Origin) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const found = query.data === undefined ? undefined : registry.findCallback(query.data, role)
      if (found === undefined) {
        yield* tg.answerCallbackQuery(query.id).pipe(Effect.ignore)
        return
      }
      const sessionKey = sessionKeyOf(origin.threadId)
      yield* found.def
        .handler({
          tgId: origin.tgId,
          chatId: origin.chatId,
          threadId: origin.threadId,
          sessionKey,
          role,
          lang,
          messageId: query.message?.message_id ?? 0,
          payload: found.payload,
          callbackId: query.id
        })
        .pipe(Effect.withSpan("dispatch.callback", { attributes: { prefix: found.def.prefix } }))
    })

  const dispatch = (update: Update): Effect.Effect<void, never, DispatchRequirements<R>> =>
    Effect.gen(function* () {
      const allowlist = yield* Allowlist
      const sessions = yield* Sessions
      const control = yield* RunControl

      const stopped = update.stopped_message_generation
      const message = update.message
      const callback = update.callback_query

      let origin: Origin | undefined
      if (stopped !== undefined) {
        if (stopped.chat.type !== "private") return
        origin = {
          tgId: TgId.make(stopped.chat.id),
          chatId: ChatId.make(stopped.chat.id),
          threadId: stopped.message_thread_id === undefined ? undefined : ThreadId.make(stopped.message_thread_id),
          languageCode: undefined
        }
      } else if (message?.from !== undefined) {
        if (message.chat.type !== "private" || message.from.is_bot) return
        origin = {
          tgId: TgId.make(message.from.id),
          chatId: ChatId.make(message.chat.id),
          threadId: message.message_thread_id === undefined ? undefined : ThreadId.make(message.message_thread_id),
          languageCode: message.from.language_code
        }
      } else if (callback !== undefined) {
        const m = callback.message
        const tid = m?.message_thread_id
        origin = {
          tgId: TgId.make(callback.from.id),
          chatId: ChatId.make(m?.chat.id ?? callback.from.id),
          threadId: tid === undefined ? undefined : ThreadId.make(tid),
          languageCode: callback.from.language_code
        }
      }
      if (origin === undefined) return
      const o = origin

      const role = yield* allowlist.roleOf(o.tgId).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (role === undefined) return

      const stored = yield* sessions.getLang.pipe(Effect.catch(() => Effect.succeed(undefined)))
      const lang = stored ?? langFromTelegram(o.languageCode)

      if (stopped !== undefined) {
        yield* control.stop(sessionKeyOf(o.threadId))
        return
      }
      if (message !== undefined) return yield* guard(o, lang, handleMessage(message, role, lang, o))
      if (callback !== undefined) return yield* guard(o, lang, handleCallback(callback, role, lang, o))
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          // Failures before a sender is known (allowlist/session storage): report only.
          if (Cause.hasInterruptsOnly(cause)) return
          yield* (yield* AdminNotifier).notify(`Dispatch failed: ${Cause.pretty(cause)}`)
        })
      ),
      Effect.withSpan("dispatch")
    ) as Effect.Effect<void, never, DispatchRequirements<R>>

  return { dispatch, guard }
}
