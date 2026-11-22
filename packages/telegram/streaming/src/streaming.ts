import { Clock, Effect, Stream } from "effect"
import type { TelegramError } from "@bot/core-contracts/errors"
import type { AgentEvent } from "@bot/core-contracts/agent-event"
import { hideChoiceMarker, splitChoices } from "@bot/core-contracts/choices"
import type { Lang } from "@bot/core-contracts/lang"
import { Telegram, type InlineKeyboard, type SendTarget } from "@bot/core-contracts/telegram"
import { escapeHtml, markdownToTelegramHtml, splitHtml } from "@bot/telegram-format/format"
import { messages } from "./messages.ts"
import { humanStatus } from "./status-labels.ts"

export const TELEGRAM_LIMIT = 4096
export const DOCUMENT_THRESHOLD = 12000
const STATUS_RESERVE = 300

export type PresentOptions = {
  readonly lang: Lang
  readonly draftId: number
  readonly throttleMs?: number
  readonly statusStyle?: "technical" | "human"
  readonly stopKeyboard?: InlineKeyboard
  readonly finalKeyboard?: (answer: FinalAnswer) => InlineKeyboard | undefined
}

export type FinalAnswer = {
  readonly text: string
  readonly choices: ReadonlyArray<string>
}

export type CompletedEvent = Extract<AgentEvent, { readonly _tag: "Completed" }>
export type FileProducedEvent = Extract<AgentEvent, { readonly _tag: "FileProduced" }>

export type PresentResult = {
  readonly completed: CompletedEvent | undefined
  readonly files: ReadonlyArray<FileProducedEvent>
  readonly messageId: number | undefined
  readonly choices: ReadonlyArray<string>
  readonly keyboard: boolean
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, "")
const isParseError = (e: TelegramError) => e.errorCode === 400 && /parse entities|can't parse/i.test(e.description)
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const withPlainFallback = <A>(run: (html: string) => Effect.Effect<A, TelegramError>, html: string) =>
  run(html).pipe(Effect.catchIf(isParseError, () => run(stripTags(html))))

export const presentRun = <E, R = never>(
  stream: Stream.Stream<AgentEvent, E, R>,
  target: SendTarget,
  opts: PresentOptions
): Effect.Effect<PresentResult, E | TelegramError, R | Telegram> => {
  const cleanup: { finished: boolean; placeholderId: number | undefined } = {
    finished: false,
    placeholderId: undefined
  }
  return Effect.gen(function* () {
    const tg = yield* Telegram
    const t = messages[opts.lang]
    const throttleMs = opts.throttleMs ?? 700

    const committed: string[] = []
    let pending = ""
    let status = ""
    let lastSent = Number.NEGATIVE_INFINITY
    let lastHtml = ""
    let mode: "draft" | "edit" = opts.stopKeyboard === undefined ? "draft" : "edit"
    let placeholderId: number | undefined
    let completed: CompletedEvent | undefined
    const files: FileProducedEvent[] = []

    const currentText = () => [...committed, pending].filter((s) => s !== "").join("\n\n")
    const stopOptions = opts.stopKeyboard === undefined ? undefined : { keyboard: opts.stopKeyboard }

    const renderPreview = (): string => {
      const text = hideChoiceMarker(currentText())
      let body = ""
      if (text.trim() !== "") {
        const chunks = splitHtml(markdownToTelegramHtml(text), TELEGRAM_LIMIT - STATUS_RESERVE)
        body = chunks[chunks.length - 1] ?? ""
      }
      const statusHtml = status !== "" ? `<i>${escapeHtml(status)}</i>` : ""
      if (body === "") return statusHtml !== "" ? statusHtml : escapeHtml(t.thinking)
      return statusHtml !== "" ? `${body}\n\n${statusHtml}` : body
    }

    const pushPreview = (html: string) =>
      Effect.gen(function* () {
        if (mode === "draft") {
          const r = yield* Effect.result(
            withPlainFallback((h) => tg.sendMessageDraft({ ...target, draftId: opts.draftId }, h), html)
          )
          if (r._tag === "Success") return
          mode = "edit"
        }
        if (placeholderId === undefined) {
          const sent = yield* Effect.result(
            withPlainFallback(
              (h) => (stopOptions === undefined ? tg.sendMessage(target, h) : tg.sendMessage(target, h, stopOptions)),
              html
            )
          )
          if (sent._tag === "Success") {
            placeholderId = sent.success.messageId
            cleanup.placeholderId = placeholderId
          }
          return
        }
        const id = placeholderId
        yield* Effect.ignore(
          withPlainFallback(
            (h) =>
              stopOptions === undefined
                ? tg.editMessageText({ ...target, messageId: id }, h)
                : tg.editMessageText({ ...target, messageId: id }, h, stopOptions),
            html
          )
        )
      })

    const flush = (force: boolean) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (!force && now - lastSent < throttleMs) return
        const html = renderPreview()
        if (html === lastHtml) return
        lastSent = now
        lastHtml = html
        yield* pushPreview(html)
      })

    const onEvent = (event: AgentEvent): Effect.Effect<void, TelegramError> => {
      switch (event._tag) {
        case "TextDelta":
          pending += event.text
          status = ""
          return flush(false)
        case "AssistantText":
          committed.push(event.text)
          pending = ""
          status = ""
          return flush(false)
        case "ToolCall":
          status =
            opts.statusStyle === "human"
              ? humanStatus(event.name, opts.lang)
              : truncate(t.tool(event.name, truncate(event.summary, 80)), 160)
          return flush(false)
        case "FileProduced":
          files.push(event)
          return Effect.void
        case "Completed":
          completed = event
          return Effect.void
        case "SessionStarted":
          return flush(false)
      }
    }

    yield* flush(true)
    lastSent = Number.NEGATIVE_INFINITY
    yield* Stream.runForEach(stream, onEvent)

    const done = completed
    if (done === undefined) return { completed: undefined, files, messageId: undefined, choices: [], keyboard: false }

    const rawText = done.isError ? "" : done.text.trim() !== "" ? done.text : currentText()
    const parsed = done.isError ? { text: rawText, choices: [] } : splitChoices(rawText)
    const finalText = parsed.text
    const asDocument = finalText.length > DOCUMENT_THRESHOLD
    const keyboard =
      done.isError || asDocument ? undefined : opts.finalKeyboard?.({ text: finalText, choices: parsed.choices })
    let lastMessageId: number | undefined = placeholderId

    const sendFinal = Effect.gen(function* () {
      if (asDocument) {
        if (placeholderId !== undefined) {
          const id = placeholderId
          yield* Effect.ignore(tg.editMessageText({ ...target, messageId: id }, escapeHtml(t.longAnswerNote)))
        }
        const sentDocument = yield* tg.sendDocument(target, {
          fileName: "answer.md",
          bytes: new TextEncoder().encode(finalText),
          caption: escapeHtml(t.longAnswer)
        })
        lastMessageId = sentDocument.messageId
        return
      }
      const raw = finalText.trim() === "" ? (done.isError ? t.errorAnswer : t.emptyAnswer) : finalText
      const chunks = splitHtml(finalText.trim() === "" ? escapeHtml(raw) : markdownToTelegramHtml(raw), TELEGRAM_LIMIT)
      const list = chunks.length === 0 ? [escapeHtml(raw)] : chunks
      const lastIndex = list.length - 1
      const optionsFor = (index: number) => (index === lastIndex && keyboard !== undefined ? { keyboard } : undefined)
      let firstToSend = 0
      if (placeholderId !== undefined) {
        const id = placeholderId
        const options = optionsFor(0)
        const edited = yield* Effect.result(
          withPlainFallback(
            (h) =>
              options === undefined
                ? tg.editMessageText({ ...target, messageId: id }, h)
                : tg.editMessageText({ ...target, messageId: id }, h, options),
            list[0]!
          )
        )
        if (edited._tag === "Success") firstToSend = 1
      }
      for (let index = firstToSend; index < list.length; index++) {
        const options = optionsFor(index)
        const sent = yield* withPlainFallback(
          (h) => (options === undefined ? tg.sendMessage(target, h) : tg.sendMessage(target, h, options)),
          list[index]!
        )
        lastMessageId = sent.messageId
      }
    })
    yield* sendFinal
    cleanup.finished = true
    return {
      completed: done,
      files,
      messageId: lastMessageId,
      choices: parsed.choices,
      keyboard: keyboard !== undefined
    }
  }).pipe(
    Effect.onExit(() =>
      Effect.gen(function* () {
        if (opts.stopKeyboard === undefined || cleanup.finished || cleanup.placeholderId === undefined) return
        const tg = yield* Telegram
        yield* Effect.ignore(tg.editMessageReplyMarkup({ ...target, messageId: cleanup.placeholderId }))
      })
    )
  )
}
