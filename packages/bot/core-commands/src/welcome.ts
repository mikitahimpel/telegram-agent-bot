import { escapeHtml as e } from "@bot/bot-commands/html"
import { defineMessages, type Lang } from "@bot/core-contracts/lang"

const abilities = {
  en: [
    "answer questions and explain things simply",
    "write and polish texts, letters and translations",
    "understand voice messages, photos and documents",
    "look things up on the internet"
  ],
  ru: [
    "отвечать на вопросы и просто объяснять сложное",
    "писать и улучшать тексты, письма и переводы",
    "понимать голосовые сообщения, фото и документы",
    "искать информацию в интернете"
  ]
} as const

const welcomeMessages = defineMessages({
  en: {
    greeting: (name: string | undefined) => (name === undefined || name === "" ? "Hi!" : `Hi, ${e(name)}!`),
    intro:
      "I'm your personal assistant. Just talk to me like you would to a person: write, send a voice message, a photo or a document.",
    can: "Here is what I can do:",
    fresh: "To start a conversation from scratch, tap “🆕 New topic” below.",
    admin: "You are the <b>admin</b> of this bot: /help shows all commands, including admin ones."
  },
  ru: {
    greeting: (name: string | undefined) => (name === undefined || name === "" ? "Привет!" : `Привет, ${e(name)}!`),
    intro:
      "Я ваш личный помощник. Просто общайтесь со мной как с человеком: пишите, отправляйте голосовые, фото или документы.",
    can: "Вот что я умею:",
    fresh: "Чтобы начать разговор с чистого листа, нажмите «🆕 Новая тема» внизу.",
    admin: "Вы <b>администратор</b> этого бота: /help покажет все команды, включая админские."
  }
})

export const renderWelcome = (
  name: string | undefined,
  lang: Lang,
  blurbs: ReadonlyArray<string>,
  isAdmin: boolean
): string => {
  const m = welcomeMessages[lang]
  const lines = [...abilities[lang], ...blurbs.map((b) => e(b))].map((l) => `• ${l}`)
  return [
    `${m.greeting(name)} ${m.intro}`,
    [m.can, ...lines].join("\n"),
    m.fresh,
    ...(isAdmin ? [m.admin] : [])
  ].join("\n\n")
}
