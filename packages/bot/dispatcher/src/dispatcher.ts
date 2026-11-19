import { Cause, Clock, Duration, Effect, Ref, Stream } from "effect"
import { errorMessage, formatClock, isNewTopicText, newTopicKeyboard } from "@bot/bot-commands/messages"
import type { Registry } from "@bot/bot-commands/registry"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { AgentRunner } from "@bot/core-contracts/agent-runner"
import { AgentEvent } from "@bot/core-contracts/agent-event"
import type { CommandContext } from "@bot/core-contracts/commands"
import { ContainerDown, type BotError } from "@bot/core-contracts/errors"
import { ChatId, ClaudeSessionId, sessionKeyOf, TgId, ThreadId, type Role, type SessionKey } from "@bot/core-contracts/ids"
import { langFromTelegram, type Lang } from "@bot/core-contracts/lang"
import { RunControl } from "@bot/core-contracts/run-control"
import { Scheduler, type JobHandler } from "@bot/core-contracts/scheduler"
import { Sessions } from "@bot/core-contracts/sessions"
import { Telegram, type SendTarget } from "@bot/core-contracts/telegram"
import { UserPrefs } from "@bot/core-contracts/user-prefs"
import { UserMemory } from "@bot/bot-memory/user-memory"
import { parseCommand } from "@bot/telegram-schema/command"
import type { CallbackQuery, Document, Message, Update } from "@bot/telegram-schema/schema"
import { messages } from "@bot/bot-commands/messages"
import { Speech } from "@bot/infra-speech/speech"
import { AdminNotifier } from "./admin-notifier.ts"
import { hasMedia, ingest, quoteOf } from "./ingest.ts"
import { McpAccess } from "./mcp-access.ts"
import { isIdleExpired, readIdleResetHours } from "./conversation.ts"
import {
  DEFERRED_RUN_KIND,
  FALLBACK_RETRY_MS,
  RESET_GRACE_MS,
  decodeDeferredPayload,
  deferredJobId,
  encodeDeferredPayload
} from "./deferred-run.ts"
import { makePromptQueue, mergePrompts, type PromptMedia } from "./prompt-queue.ts"
import { RunSlots } from "./run-control.ts"

export type PresentRun = (args: {
  readonly to: SendTarget
  readonly lang: Lang
  readonly role: Role
  readonly stream: Stream.Stream<AgentEvent, BotError>
}) => Effect.Effect<void, BotError, Telegram>

export type DocumentHook<R> = (args: {
  readonly document: Document
  readonly tgId: TgId
  readonly chatId: ChatId
  readonly threadId: ThreadId | undefined
  readonly lang: Lang
}) => Effect.Effect<boolean, BotError, R>

export type DispatcherOptions<R> = {
  readonly registry: Registry<R>
  readonly present: PresentRun
  readonly onDocument?: DocumentHook<R>
  readonly botUsername?: string
  readonly albumWindow?: Duration.Input
  readonly retryDelay?: Duration.Input
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
  | Speech
  | Scheduler
  | UserPrefs
  | UserMemory

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

type Origin = {
  readonly tgId: TgId
  readonly chatId: ChatId
  readonly threadId: ThreadId | undefined
  readonly languageCode: string | undefined
}

export const makeDispatcher = <R>(options: DispatcherOptions<R>) => {
  const { registry, present } = options
  const profiles = new Map<number, string>()
  const albums = new Map<string, Array<Message>>()
  const albumWindow = options.albumWindow ?? Duration.millis(1500)
  const queue = makePromptQueue()
  const retryDelay = options.retryDelay ?? "2 seconds"
  const keyFor = (role: Role, threadId: ThreadId | undefined): SessionKey =>
    sessionKeyOf(role === "admin" ? threadId : undefined)

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
      const sessionKey = keyFor(role, threadId)
      if (message.document !== undefined && options.onDocument !== undefined) {
        const handled = yield* options.onDocument({
          document: message.document,
          tgId: origin.tgId,
          chatId: origin.chatId,
          threadId,
          lang
        })
        if (handled) return
      }
      if (hasMedia(message)) {
        const mediaGroupId = message.media_group_id
        let parts: ReadonlyArray<Message> = [message]
        if (mediaGroupId !== undefined) {
          const pending = albums.get(mediaGroupId)
          if (pending !== undefined) {
            pending.push(message)
            return
          }
          albums.set(mediaGroupId, [message])
          yield* Effect.sleep(albumWindow)
          parts = albums.get(mediaGroupId) ?? [message]
          albums.delete(mediaGroupId)
        }
        const to = targetOf(origin.chatId, threadId)
        const input = yield* ingest(parts, lang, to)
        if (input === undefined) return
        yield* sessions.ensure(sessionKey, threadId)
        yield* runPrompt(origin, sessionKey, lang, role, input.prompt, { media: input, messageId: message.message_id })
        return
      }
      const text = message.text ?? message.caption
      if (text === undefined || text.trim() === "") return
      if (isNewTopicText(text)) return yield* resetConversation(origin, sessionKey, lang)
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
      yield* runPrompt(origin, sessionKey, lang, role, text, { messageId: message.message_id })
    })

  type RunReq =
    | Sessions
    | AgentRunner
    | RunSlots
    | RunControl
    | Telegram
    | McpAccess
    | Scheduler
    | AdminNotifier
    | UserPrefs
    | UserMemory

  type PromptOptions = { readonly media?: PromptMedia | undefined; readonly messageId?: number | undefined }

  const resetConversation = (origin: Origin, sessionKey: SessionKey, lang: Lang) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const control = yield* RunControl
      const scheduler = yield* Scheduler
      const tg = yield* Telegram
      queue.clear(sessionKey)
      yield* control.stop(sessionKey)
      yield* scheduler.cancel(deferredJobId(origin.tgId, sessionKey)).pipe(Effect.ignore)
      yield* sessions.ensure(sessionKey, origin.threadId)
      yield* sessions.reset(sessionKey)
      yield* tg.sendMessage(targetOf(origin.chatId, origin.threadId), messages[lang].newTopicDone, {
        replyKeyboard: newTopicKeyboard(lang)
      })
    })

  const acknowledge = (origin: Origin, lang: Lang, messageId: number | undefined) =>
    Effect.gen(function* () {
      if (messageId === undefined) return
      const tg = yield* Telegram
      const to = targetOf(origin.chatId, origin.threadId)
      const reacted = yield* tg.setMessageReaction({ ...to, messageId }, "✍").pipe(Effect.result)
      if (reacted._tag === "Failure") yield* tg.sendMessage(to, messages[lang].queuedAck).pipe(Effect.ignore)
    })

  const deferRun = (
    origin: Origin,
    sessionKey: SessionKey,
    lang: Lang,
    role: Role,
    prompt: string,
    resetsAt: number | undefined
  ) =>
    Effect.gen(function* () {
      const scheduler = yield* Scheduler
      const tg = yield* Telegram
      const prefs = yield* UserPrefs
      const now = yield* Clock.currentTimeMillis
      const at = resetsAt === undefined ? now + FALLBACK_RETRY_MS : Math.max(resetsAt, now) + RESET_GRACE_MS
      const id = deferredJobId(origin.tgId, sessionKey)
      const existing = yield* scheduler.get(id)
      const previous = existing === undefined ? undefined : decodeDeferredPayload(existing.payload)
      const earlier = previous !== undefined && previous._tag === "Some" ? [{ prompt: previous.value.prompt }] : []
      const merged = mergePrompts([...earlier, { prompt }, ...queue.drain(sessionKey)])
      const payload = encodeDeferredPayload({
        tgId: origin.tgId,
        chatId: origin.chatId,
        ...(origin.threadId === undefined ? {} : { threadId: origin.threadId }),
        lang,
        role,
        prompt: merged.prompt
      })
      yield* scheduler.schedule({ id, kind: DEFERRED_RUN_KIND, at, payload })
      const m = messages[lang]
      const timeZone = yield* prefs.timeZone(origin.tgId).pipe(Effect.catch(() => Effect.succeed(undefined)))
      yield* tg.sendMessage(
        targetOf(origin.chatId, origin.threadId),
        resetsAt === undefined ? m.limitDeferredSoon : m.limitDeferred(formatClock(at, now, lang, timeZone))
      )
    })

  const runPrompt = (
    origin: Origin,
    sessionKey: SessionKey,
    lang: Lang,
    role: Role,
    prompt: string,
    opts: PromptOptions = {}
  ): Effect.Effect<void, BotError, RunReq> =>
    Effect.gen(function* () {
      const result = yield* runOnce(origin, sessionKey, lang, role, prompt, opts.media).pipe(Effect.result)
      if (result._tag === "Success") {
        const more = queue.drain(sessionKey)
        if (more.length === 0) return
        const merged = mergePrompts(more)
        return yield* runPrompt(origin, sessionKey, lang, role, merged.prompt, { media: merged.media })
      }
      const err = result.failure
      const tg = yield* Telegram
      switch (err._tag) {
        case "AgentBusy": {
          if (queue.push(sessionKey, { prompt, media: opts.media }) === "full") {
            yield* tg.sendMessage(targetOf(origin.chatId, origin.threadId), messages[lang].busy)
            return
          }
          yield* acknowledge(origin, lang, opts.messageId)
          return
        }
        case "SubscriptionLimitReached":
          return yield* deferRun(origin, sessionKey, lang, role, prompt, err.resetsAt)
        case "ApiCreditsExhausted": {
          queue.clear(sessionKey)
          yield* tg.sendMessage(targetOf(origin.chatId, origin.threadId), messages[lang].apiCreditsUser)
          yield* (yield* AdminNotifier).notify(messages.en.apiCreditsAdmin(origin.tgId))
          return
        }
        case "RunInterrupted":
          queue.clear(sessionKey)
          return
        default:
          queue.clear(sessionKey)
          return yield* Effect.fail(err)
      }
    })

  const runOnce = (
    origin: Origin,
    sessionKey: SessionKey,
    lang: Lang,
    role: Role,
    prompt: string,
    media: PromptMedia | undefined
  ) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const runner = yield* AgentRunner
      const slots = yield* RunSlots
      const tg = yield* Telegram
      const mcpAccess = yield* McpAccess
      const to = targetOf(origin.chatId, origin.threadId)

      yield* sessions.checkDailyLimit
      const record = yield* sessions.ensure(sessionKey, origin.threadId)
      const now = yield* Clock.currentTimeMillis
      const idleHours = yield* readIdleResetHours
      let resume = record.claudeSessionId
      if (role !== "admin" && resume !== undefined && isIdleExpired(record.lastUsedAt, now, idleHours)) {
        yield* sessions.reset(sessionKey)
        resume = undefined
      }
      const mcp = yield* mcpAccess.issue(origin.tgId)
      const memory = yield* (yield* UserMemory)
        .forUser(origin.tgId)
        .render.pipe(Effect.catch(() => Effect.succeed(undefined)))

      const attempt = Effect.gen(function* () {
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

        const quote = media?.heard === undefined ? undefined : quoteOf(media.heard)
        const withQuote = (event: AgentEvent): AgentEvent =>
          quote !== undefined && event._tag === "Completed" ? { ...event, text: `${quote}\n\n${event.text}` } : event

        const run = runner
          .run({
            tgId: origin.tgId,
            sessionKey,
            resume,
            prompt,
            ...(media !== undefined && media.attachments.length > 0 ? { attachments: media.attachments } : {}),
            lang,
            ...(memory === undefined ? {} : { memory }),
            mcp
          })
          .pipe(Stream.tap(tap))
        const stream: Stream.Stream<AgentEvent, BotError> =
          quote === undefined
            ? run
            : Stream.concat(Stream.make(AgentEvent.AssistantText({ text: quote })), run.pipe(Stream.map(withQuote)))

        const execute = present({ to, lang, role, stream }).pipe(
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
        if (!(yield* Ref.get(completed))) {
          return yield* new ContainerDown({ reason: "agent run ended without a result" })
        }
        return yield* Ref.get(files)
      })

      const produced = yield* attempt.pipe(
        Effect.catchIf(
          (e): e is ContainerDown => e._tag === "ContainerDown",
          () => Effect.sleep(retryDelay).pipe(Effect.andThen(attempt))
        )
      )

      for (const file of produced) {
        yield* runner.readFile(origin.tgId, file.path).pipe(
          Effect.flatMap((bytes) => tg.sendDocument(to, { fileName: file.fileName, bytes })),
          Effect.catch((e) => guard(origin, lang, Effect.fail(e)))
        )
      }
    })

  const deferredRunHandler: JobHandler<DispatchRequirements<R>> = {
    kind: DEFERRED_RUN_KIND,
    run: (job) => {
      const decoded = decodeDeferredPayload(job.payload)
      if (decoded._tag === "None") return Effect.void
      const p = decoded.value
      const origin: Origin = {
        tgId: TgId.make(p.tgId),
        chatId: ChatId.make(p.chatId),
        threadId: p.threadId === undefined ? undefined : ThreadId.make(p.threadId),
        languageCode: undefined
      }
      return guard(origin, p.lang, runPrompt(origin, keyFor(p.role, origin.threadId), p.lang, p.role, p.prompt))
    }
  }

  const handleCallback = (query: CallbackQuery, role: Role, lang: Lang, origin: Origin) =>
    Effect.gen(function* () {
      const tg = yield* Telegram
      const found = query.data === undefined ? undefined : registry.findCallback(query.data, role)
      if (found === undefined) {
        yield* tg.answerCallbackQuery(query.id).pipe(Effect.ignore)
        return
      }
      const sessionKey = keyFor(role, origin.threadId)
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

      const from = message?.from ?? callback?.from
      if (role === "user" && from !== undefined) {
        const signature = `${from.first_name}\u0000${from.username ?? ""}`
        if (profiles.get(o.tgId) !== signature) {
          const updated = yield* allowlist
            .updateProfile(o.tgId, {
              name: from.first_name,
              ...(from.username === undefined ? {} : { username: from.username })
            })
            .pipe(Effect.result)
          if (updated._tag === "Success") profiles.set(o.tgId, signature)
        }
      }

      const stored = yield* sessions.getLang.pipe(Effect.catch(() => Effect.succeed(undefined)))
      const lang = stored ?? langFromTelegram(o.languageCode)

      if (stopped !== undefined) {
        yield* control.stop(keyFor(role, o.threadId))
        return
      }
      if (message !== undefined) return yield* guard(o, lang, handleMessage(message, role, lang, o))
      if (callback !== undefined) return yield* guard(o, lang, handleCallback(callback, role, lang, o))
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (Cause.hasInterruptsOnly(cause)) return
          yield* (yield* AdminNotifier).notify(`Dispatch failed: ${Cause.pretty(cause)}`)
        })
      ),
      Effect.withSpan("dispatch")
    ) as Effect.Effect<void, never, DispatchRequirements<R>>

  return { dispatch, guard, jobs: [deferredRunHandler] as ReadonlyArray<JobHandler<DispatchRequirements<R>>> }
}
