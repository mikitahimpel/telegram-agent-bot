import { defineMessages, type Lang } from "@bot/core-contracts/lang"
import type { Repeat } from "./tz.ts"

export const messages = defineMessages({
  en: {
    description: "Your reminders",
    title: "Reminders",
    listHeader: (n: number) => `<b>Your reminders (${n})</b>`,
    empty: "You have no reminders. Just tell me what to remind you about and when.",
    line: (i: number, text: string, when: string, repeat: string) => `${i}. ${text} - ${when}${repeat}`,
    cancelButton: (text: string) => `Cancel: ${text}`,
    fired: (text: string) => `⏰ ${text}`,
    done: "✅ Done",
    snooze: "⏰ In an hour",
    tomorrow: "📅 Tomorrow",
    markedDone: (text: string) => `✅ ${text}`,
    movedTo: (text: string, when: string) => `⏰ ${text}\nReminding again: ${when}`,
    gone: "This reminder is no longer active.",
    cancelled: "Cancelled",
    ok: "Done"
  },
  ru: {
    description: "Ваши напоминания",
    title: "Напоминания",
    listHeader: (n: number) => `<b>Ваши напоминания (${n})</b>`,
    empty: "Напоминаний пока нет. Просто напишите, о чём и когда напомнить.",
    line: (i: number, text: string, when: string, repeat: string) => `${i}. ${text} - ${when}${repeat}`,
    cancelButton: (text: string) => `Отменить: ${text}`,
    fired: (text: string) => `⏰ ${text}`,
    done: "✅ Готово",
    snooze: "⏰ Через час",
    tomorrow: "📅 Завтра",
    markedDone: (text: string) => `✅ ${text}`,
    movedTo: (text: string, when: string) => `⏰ ${text}\nНапомню снова: ${when}`,
    gone: "Это напоминание уже неактуально.",
    cancelled: "Отменено",
    ok: "Готово"
  }
})

export const repeatSuffix: { readonly [L in Lang]: Record<Repeat, string> } = {
  en: { none: "", daily: ", every day", weekdays: ", on weekdays", weekly: ", every week", monthly: ", every month" },
  ru: { none: "", daily: ", каждый день", weekdays: ", по будням", weekly: ", каждую неделю", monthly: ", каждый месяц" }
}
