import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
    thinking: "Thinking…",
    tool: (name: string, summary: string) => (summary === "" ? `🔧 ${name}` : `🔧 ${name}: ${summary}`),
    longAnswer: "The answer is long, so I attached it as a file.",
    longAnswerNote: "📎 Full answer attached as a file below.",
    emptyAnswer: "(empty answer)",
    errorAnswer: "⚠️ The run failed."
  },
  ru: {
    thinking: "Думаю…",
    tool: (name: string, summary: string) => (summary === "" ? `🔧 ${name}` : `🔧 ${name}: ${summary}`),
    longAnswer: "Ответ длинный, поэтому прикладываю его файлом.",
    longAnswerNote: "📎 Полный ответ приложен файлом ниже.",
    emptyAnswer: "(пустой ответ)",
    errorAnswer: "⚠️ Запуск завершился с ошибкой."
  }
})
