import { defineMessages, type Lang } from "@bot/core-contracts/lang"
import type { BotError } from "@bot/core-contracts/errors"

const pad = (n: number) => String(n).padStart(2, "0")

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** Epoch ms → human date-time in UTC, formatted per language ("Nov 19, 14:30 UTC" / "19 ноя, 14:30 UTC"). */
export const formatDateTime = (ms: number, lang: Lang): string => {
  const d = new Date(ms)
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  const day = d.getUTCDate()
  return lang === "ru"
    ? `${day} ${MONTHS_RU[d.getUTCMonth()]}, ${time}`
    : `${MONTHS_EN[d.getUTCMonth()]} ${day}, ${time}`
}

/** Generic messages shared by the dispatcher, commands and plugins. All values are HTML. */
export const messages = defineMessages({
  en: {
    unknownCommand: "Unknown command. Send /help to see what I can do.",
    busy: "I'm still working on the previous message in this session. Wait for it to finish or send /stop.",
    dailyLimit: (limit: number) => `Daily limit reached: ${limit} requests per day. Try again tomorrow.`,
    subscriptionLimit: (resetsAt: number | undefined) =>
      resetsAt === undefined
        ? "The Claude usage limit is exhausted. Please try again later."
        : `The Claude usage limit is exhausted. It resets at ${formatDateTime(resetsAt, "en")}.`,
    containerDown: "The agent's environment is not available right now. Please try again in a minute.",
    genericError: "Something went wrong. Please try again later."
  },
  ru: {
    unknownCommand: "Неизвестная команда. Отправьте /help, чтобы увидеть, что я умею.",
    busy: "Я ещё обрабатываю предыдущее сообщение в этой сессии. Дождитесь ответа или отправьте /stop.",
    dailyLimit: (limit: number) => `Дневной лимит исчерпан: ${limit} запросов в день. Попробуйте завтра.`,
    subscriptionLimit: (resetsAt: number | undefined) =>
      resetsAt === undefined
        ? "Лимит использования Claude исчерпан. Попробуйте позже."
        : `Лимит использования Claude исчерпан. Он сбросится ${formatDateTime(resetsAt, "ru")}.`,
    containerDown: "Окружение агента сейчас недоступно. Попробуйте через минуту.",
    genericError: "Что-то пошло не так. Попробуйте позже."
  }
})

/**
 * Localized HTML for a failure, or `undefined` when the bot must stay silent
 * (Unauthorized, and RunInterrupted because the stop command already confirms).
 */
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
    case "ContainerDown":
      return m.containerDown
    case "TelegramError":
    case "StorageError":
      return m.genericError
  }
}
