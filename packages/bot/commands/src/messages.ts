import { defineMessages, type Lang } from "@bot/core-contracts/lang"
import type { BotError } from "@bot/core-contracts/errors"
import { interactionMessages } from "./interaction.ts"

const pad = (n: number) => String(n).padStart(2, "0")

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

export const formatDateTime = (ms: number, lang: Lang): string => {
  const d = new Date(ms)
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  const day = d.getUTCDate()
  return lang === "ru"
    ? `${day} ${MONTHS_RU[d.getUTCMonth()]}, ${time}`
    : `${MONTHS_EN[d.getUTCMonth()]} ${day}, ${time}`
}

type ClockParts = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
}

const partsIn = (ms: number, tz: string): ClockParts | undefined => {
  try {
    const out: Record<string, number> = {}
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric"
    }).formatToParts(new Date(ms))
    for (const part of parts) if (part.type !== "literal") out[part.type] = Number(part.value)
    return {
      year: out["year"] ?? 1970,
      month: out["month"] ?? 1,
      day: out["day"] ?? 1,
      hour: (out["hour"] ?? 0) % 24,
      minute: out["minute"] ?? 0
    }
  } catch {
    return undefined
  }
}

export const formatClock = (ms: number, now: number, lang: Lang, timeZone?: string): string => {
  const local = timeZone === undefined ? undefined : partsIn(ms, timeZone)
  const zone = local === undefined ? "UTC" : (timeZone as string)
  const at = local ?? partsIn(ms, "UTC")!
  const today = partsIn(now, zone)!
  const clock = `${pad(at.hour)}:${pad(at.minute)}`
  const sameDay = at.year === today.year && at.month === today.month && at.day === today.day
  const month = lang === "ru" ? MONTHS_RU[at.month - 1] : MONTHS_EN[at.month - 1]
  const base = sameDay ? clock : lang === "ru" ? `${at.day} ${month} в ${clock}` : `${month} ${at.day} at ${clock}`
  return local === undefined ? `${base} UTC` : base
}

export const messages = defineMessages({
  en: {
    unknownCommand: "Unknown command. Send /help to see what I can do.",
    busy: "Please wait, I'm still answering.",
    queuedAck: "Noted ✍️",
    newTopicButton: "🆕 New topic",
    newTopicDone: "Done, let's start fresh. What would you like to talk about?",
    limitDeferred: (time: string) => `There are a lot of questions right now. I'll answer at about ${time}.`,
    limitDeferredSoon: "There are a lot of questions right now. I'll answer a bit later.",
    apiCreditsUser: "I can't answer right now, we're already fixing it. Please try again later.",
    apiCreditsAdmin: (tgId: number) => `The Anthropic API credits ran out (user ${tgId}). Top them up.`,
    technicalFailure: (tgId: number, detail: string) => `Run failed twice for user ${tgId}: ${detail}`,
    dailyLimit: (limit: number) => `Daily limit reached: ${limit} requests per day. Try again tomorrow.`,
    subscriptionLimit: (resetsAt: number | undefined) =>
      resetsAt === undefined
        ? "There are a lot of questions right now. Please try again later."
        : `There are a lot of questions right now. I'll be able to answer at ${formatDateTime(resetsAt, "en")}.`,
    apiCredits: "I can't answer right now, we're already fixing it. Please try again later.",
    containerDown: "Something went wrong, please try again a bit later.",
    genericError: "Something went wrong. Please try again later."
  },
  ru: {
    unknownCommand: "Неизвестная команда. Отправьте /help, чтобы увидеть, что я умею.",
    busy: "Подождите, я ещё отвечаю.",
    queuedAck: "Учту ✍️",
    newTopicButton: "🆕 Новая тема",
    newTopicDone: "Хорошо, начнём с чистого листа. О чём поговорим?",
    limitDeferred: (time: string) => `Сейчас много вопросов, отвечу примерно в ${time}.`,
    limitDeferredSoon: "Сейчас много вопросов, отвечу чуть позже.",
    apiCreditsUser: "Сейчас я не могу ответить, мы уже разбираемся. Попробуйте чуть позже.",
    apiCreditsAdmin: (tgId: number) => `Закончились кредиты Anthropic API (пользователь ${tgId}). Пополните их.`,
    technicalFailure: (tgId: number, detail: string) => `Запуск дважды завершился ошибкой у ${tgId}: ${detail}`,
    dailyLimit: (limit: number) => `Дневной лимит исчерпан: ${limit} запросов в день. Попробуйте завтра.`,
    subscriptionLimit: (resetsAt: number | undefined) =>
      resetsAt === undefined
        ? "Сейчас много вопросов. Попробуйте позже."
        : `Сейчас много вопросов. Смогу ответить ${formatDateTime(resetsAt, "ru")}.`,
    apiCredits: "Сейчас я не могу ответить, мы уже разбираемся. Попробуйте чуть позже.",
    containerDown: "Что-то пошло не так, попробуйте чуть позже.",
    genericError: "Что-то пошло не так. Попробуйте позже."
  }
})

export const errorMessage = (err: BotError, lang: Lang): string | undefined => {
  const m = messages[lang]
  switch (err._tag) {
    case "Unauthorized":
    case "RunInterrupted":
      return undefined
    case "AgentBusy":
      return m.busy
    case "DailyLimitReached":
      return m.dailyLimit(err.limit)
    case "SubscriptionLimitReached":
      return m.subscriptionLimit(err.resetsAt)
    case "ApiCreditsExhausted":
      return m.apiCredits
    case "ContainerDown":
      return m.containerDown
    case "TelegramError":
    case "StorageError":
      return m.genericError
  }
}

export const isNewTopicText = (text: string): boolean => {
  const t = text.trim()
  return t === messages.en.newTopicButton || t === messages.ru.newTopicButton
}

export const newTopicKeyboard = (lang: Lang) => ({
  rows: [[messages[lang].newTopicButton, interactionMessages[lang].menuButton]]
})
