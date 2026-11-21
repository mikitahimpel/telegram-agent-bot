import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
    thinking: "Thinking…",
    tool: (name: string, summary: string) => (summary === "" ? `🔧 ${name}` : `🔧 ${name}: ${summary}`),
    longAnswer: "The answer is long, so I attached it as a file.",
    longAnswerNote: "📎 Full answer attached as a file below.",
    emptyAnswer: "(empty answer)",
    errorAnswer: "⚠️ Something went wrong, please try again in a moment."
  },
  ru: {
    thinking: "Думаю…",
    tool: (name: string, summary: string) => (summary === "" ? `🔧 ${name}` : `🔧 ${name}: ${summary}`),
    longAnswer: "Ответ длинный, поэтому прикладываю его файлом.",
    longAnswerNote: "📎 Полный ответ приложен файлом ниже.",
    emptyAnswer: "(пустой ответ)",
    errorAnswer: "⚠️ Что-то пошло не так, попробуйте ещё раз чуть позже."
  }
})

export const statusLabels = {
  en: {
    search: "Searching the web…",
    fetch: "Reading a page…",
    readFile: "Reading a file…",
    writeFile: "Preparing a file…",
    compute: "Calculating…",
    car: "Looking at the car data…",
    reminder: "Setting a reminder…",
    thinking: "Thinking…"
  },
  ru: {
    search: "Ищу в интернете…",
    fetch: "Читаю страницу…",
    readFile: "Читаю файл…",
    writeFile: "Готовлю файл…",
    compute: "Считаю…",
    car: "Смотрю данные машины…",
    reminder: "Ставлю напоминание…",
    thinking: "Думаю…"
  }
} as const
