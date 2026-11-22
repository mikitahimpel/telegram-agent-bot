import { defineMessages, type Lang } from "@bot/core-contracts/lang"
import type { InlineKeyboard } from "@bot/core-contracts/telegram"

export const MIN_QUICK_ACTION_LENGTH = 40
const SHORT_CHOICE_LENGTH = 12

export const QUICK_ACTIONS = ["retry", "short", "more", "translate", "fshort", "fdates", "fask"] as const
export type QuickAction = (typeof QUICK_ACTIONS)[number]

export const MENU_ITEMS = ["news", "weather", "letter", "remind", "doc", "memory", "car"] as const
export type MenuItem = (typeof MENU_ITEMS)[number]

export type AnswerKind = "text" | "file"

export type Interaction =
  | { readonly kind: "quick"; readonly action: QuickAction }
  | { readonly kind: "choice"; readonly index: number }
  | { readonly kind: "stop" }
  | { readonly kind: "menu"; readonly item: MenuItem }

export const quickData = (action: QuickAction) => `qa:${action}`
export const choiceData = (index: number) => `ch:${index}`
export const STOP_DATA = "stop:"
export const menuData = (item: MenuItem) => `menu:${item}`

const isQuickAction = (s: string): s is QuickAction => (QUICK_ACTIONS as ReadonlyArray<string>).includes(s)
const isMenuItem = (s: string): s is MenuItem => (MENU_ITEMS as ReadonlyArray<string>).includes(s)

export const parseInteraction = (data: string): Interaction | undefined => {
  const colon = data.indexOf(":")
  if (colon === -1) return undefined
  const prefix = data.slice(0, colon)
  const rest = data.slice(colon + 1)
  switch (prefix) {
    case "qa":
      return isQuickAction(rest) ? { kind: "quick", action: rest } : undefined
    case "ch":
      return /^\d{1,2}$/.test(rest) ? { kind: "choice", index: Number(rest) } : undefined
    case "stop":
      return { kind: "stop" }
    case "menu":
      return isMenuItem(rest) ? { kind: "menu", item: rest } : undefined
    default:
      return undefined
  }
}

export const interactionMessages = defineMessages({
  en: {
    stale: "This button is outdated.",
    working: "On it…",
    stopButton: "⏹ Stop",
    stopped: "Stopped",
    fileQuestion: "What would you like to know about this file?",
    menuButton: "☰ Menu",
    menuIntro: "Here is what you can try. Tap a button:",
    menuTry: "Or just write to me in your own words.",
    retry: "🔄 Again",
    short: "✂️ Shorter",
    more: "📖 More detail",
    translate: "🌐 Translate",
    fshort: "✂️ Brief",
    fdates: "📌 Dates & amounts",
    fask: "❓ Ask a question",
    news: "📰 News today",
    weather: "🌤 Weather",
    letter: "📝 Write a letter",
    remind: "⏰ Set a reminder",
    doc: "📄 Read a document",
    memory: "🧠 What you remember about me",
    car: "🚗 My car"
  },
  ru: {
    stale: "Эта кнопка устарела.",
    working: "Секунду…",
    stopButton: "⏹ Остановить",
    stopped: "Остановлено",
    fileQuestion: "Что хотите узнать об этом файле?",
    menuButton: "☰ Что умею",
    menuIntro: "Вот что можно попробовать. Нажмите на кнопку:",
    menuTry: "Или просто напишите мне своими словами.",
    retry: "🔄 Ещё раз",
    short: "✂️ Короче",
    more: "📖 Подробнее",
    translate: "🌐 Перевести",
    fshort: "✂️ Кратко",
    fdates: "📌 Даты и суммы",
    fask: "❓ Задать вопрос",
    news: "📰 Новости сегодня",
    weather: "🌤 Погода",
    letter: "📝 Написать письмо",
    remind: "⏰ Поставить напоминание",
    doc: "📄 Разобрать документ",
    memory: "🧠 Что ты обо мне помнишь",
    car: "🚗 Моя машина"
  }
})

const followUps = defineMessages({
  en: {
    short: "Answer more briefly: retell your last answer in one or two sentences.",
    more: "Tell me more: explain your last answer in more detail.",
    translate: "Translate your last answer into Russian.",
    fshort: "Briefly retell what is in the file in 3 to 5 sentences.",
    fdates: "List all the dates and amounts from the file, without skipping any.",
    news: "Tell me the main news today.",
    weather: "What is the weather today? If you don't know where I am, ask me for my city first.",
    memory: "Tell me what you remember about me.",
    car: "Tell me about my car: what the data shows and what I should pay attention to."
  },
  ru: {
    short: "Ответь короче: перескажи свой последний ответ в одном-двух предложениях.",
    more: "Расскажи подробнее: объясни свой последний ответ развёрнуто.",
    translate: "Переведи свой последний ответ на английский язык.",
    fshort: "Кратко перескажи, что в файле, в 3–5 предложениях.",
    fdates: "Выпиши из файла все даты и суммы списком, ничего не пропуская.",
    news: "Расскажи главные новости на сегодня.",
    weather: "Какая сегодня погода? Если не знаешь, где я, сначала спроси мой город.",
    memory: "Расскажи, что ты обо мне помнишь.",
    car: "Расскажи о моей машине: что видно по данным и на что стоит обратить внимание."
  }
})

const menuHints = defineMessages({
  en: {
    letter: "Write who the letter is for and what it should say, and I will draft it.",
    remind: "Write what and when to remind you, for example: “Remind me tomorrow at 9 to call mom”.",
    doc: "Send me a document or a photo and tell me what to do with it."
  },
  ru: {
    letter: "Напишите, кому письмо и о чём оно, и я его составлю.",
    remind: "Напишите, о чём и когда напомнить, например: «Напомни завтра в 9 утра позвонить маме».",
    doc: "Пришлите документ или фото и скажите, что с ним сделать."
  }
})

export const followUpPrompt = (action: QuickAction, lang: Lang): string | undefined => {
  switch (action) {
    case "short":
    case "more":
    case "translate":
    case "fshort":
    case "fdates":
      return followUps[lang][action]
    case "retry":
    case "fask":
      return undefined
  }
}

export type MenuEntry =
  | { readonly kind: "prompt"; readonly text: string; readonly label: string }
  | { readonly kind: "hint"; readonly text: string }

export const menuEntry = (item: MenuItem, lang: Lang): MenuEntry => {
  switch (item) {
    case "news":
    case "weather":
    case "memory":
    case "car":
      return { kind: "prompt", text: followUps[lang][item], label: interactionMessages[lang][item] }
    case "letter":
    case "remind":
    case "doc":
      return { kind: "hint", text: menuHints[lang][item] }
  }
}

const pairs = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> => {
  const rows: Array<Array<A>> = []
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2))
  return rows
}

export const quickActionsKeyboard = (lang: Lang, kind: AnswerKind): InlineKeyboard => {
  const m = interactionMessages[lang]
  const button = (action: QuickAction) => ({ text: m[action], callbackData: quickData(action) })
  return kind === "file"
    ? pairs((["fshort", "fdates", "translate", "fask"] as const).map(button))
    : pairs((["retry", "short", "more", "translate"] as const).map(button))
}

export const choicesKeyboard = (choices: ReadonlyArray<string>): InlineKeyboard => {
  const buttons = choices.map((text, index) => ({ text, callbackData: choiceData(index) }))
  return choices.every((c) => c.length <= SHORT_CHOICE_LENGTH) ? pairs(buttons) : buttons.map((b) => [b])
}

export const menuKeyboard = (lang: Lang, options: { readonly car: boolean }): InlineKeyboard => {
  const m = interactionMessages[lang]
  const items = MENU_ITEMS.filter((i) => i !== "car" || options.car)
  return pairs(items.map((item) => ({ text: m[item], callbackData: menuData(item) })))
}

export const isMenuText = (text: string): boolean => {
  const t = text.trim()
  return t === interactionMessages.en.menuButton || t === interactionMessages.ru.menuButton
}
