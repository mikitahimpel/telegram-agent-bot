import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
    title: "Memory",
    description: "What I remember about you",
    listHeader: (n: number, used: number, budget: number) => `<b>What I remember about you (${n})</b>\n<i>${used} of ${budget} tokens used</i>`,
    line: (i: number, text: string) => `${i}. ${text}`,
    empty: "I don't remember anything about you yet. Just tell me about yourself and I'll keep the important things in mind.",
    forgetButton: (text: string) => `Forget: ${text}`,
    forgetAllButton: "Forget everything",
    confirmAllText: (n: number) => `Forget all ${n} facts about you? This cannot be undone.`,
    confirmAllYes: "Yes, forget everything",
    confirmAllNo: "Cancel",
    forgotten: "Forgotten",
    allForgotten: "Done, I forgot everything about you.",
    gone: "That is already gone.",
    ok: "Done"
  },
  ru: {
    title: "Память",
    description: "Что я о вас помню",
    listHeader: (n: number, used: number, budget: number) => `<b>Что я о вас помню (${n})</b>\n<i>Занято ${used} из ${budget} токенов</i>`,
    line: (i: number, text: string) => `${i}. ${text}`,
    empty: "Пока я ничего о вас не помню. Просто расскажите о себе, и я запомню важное.",
    forgetButton: (text: string) => `Забыть: ${text}`,
    forgetAllButton: "Забыть всё",
    confirmAllText: (n: number) => `Забыть все факты о вас (${n})? Это нельзя отменить.`,
    confirmAllYes: "Да, забыть всё",
    confirmAllNo: "Отмена",
    forgotten: "Забыто",
    allForgotten: "Готово, я забыл всё, что знал о вас.",
    gone: "Этого уже нет.",
    ok: "Готово"
  }
})
