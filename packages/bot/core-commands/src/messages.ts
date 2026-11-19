import { escapeHtml as e } from "@bot/bot-commands/html"
import { formatDateTime } from "@bot/bot-commands/messages"
import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
    start: "Hi! I'm a Claude agent in Telegram. Just write me a message, or use /new to start a separate session in its own topic.",
    startAdmin: "You are the <b>admin</b> of this bot: /help shows all commands, including admin ones.",
    startLang: "The interface language can be changed with /lang.",
    newDefaultTitle: "New session",
    newCreated: (title: string) => `Session <b>${e(title)}</b> created. Write your first message here.`,
    topicsDisabled:
      "I couldn't create a topic: topic mode is probably disabled for this bot. Open @BotFather, open the bot's settings in its Mini App and enable topics in private chats (and allow users to create topics if you want to make them yourself). Then try /new again.",
    sessionsEmpty: "No sessions yet. Send a message or use /new.",
    sessionsHeader: "<b>Sessions</b>",
    sessionLine: (title: string, runs: number, lastUsed: string, current: boolean) =>
      `${current ? "▶ " : "• "}<b>${e(title)}</b> — ${runs} runs, last used ${lastUsed}`,
    stopped: "Stopped.",
    nothingRunning: "Nothing is running in this session.",
    langPrompt: "Choose a language:",
    langUsage: "Usage: <code>/lang [ru|en]</code>",
    langChanged: "Language set to English.",
    agentsEmpty: "No agents yet.",
    usageUsage: "Usage: <code>/usage [tgId]</code>",
    tgIdUsage: (cmd: string) => `Usage: <code>/${cmd} &lt;tgId&gt;</code> (a numeric Telegram id)`,
    allowed: (id: number) => `Access granted to <code>${id}</code>.`,
    alreadyAllowed: (id: number) => `<code>${id}</code> already has access.`,
    revokeAdmin: "The admin cannot be revoked.",
    revokeAsk: (id: number) => `Revoke access for <code>${id}</code>?`,
    revoked: (id: number) => `Access revoked for <code>${id}</code>.`,
    killAsk: (id: number) => `Kill the agent of <code>${id}</code>? Running requests stop and the container is destroyed.`,
    killed: (id: number) => `Agent <code>${id}</code> killed.`,
    restarted: (id: number) => `Agent <code>${id}</code> restarted.`,
    cancelled: "Cancelled.",
    btnRevoke: "Revoke",
    btnKill: "Kill",
    btnCancel: "Cancel",
    usageOne: (id: number, today: string, total: number, cost: string, tin: number, tout: number, last: string) =>
      `<b>Agent ${id}</b>\nToday: ${today}\nRuns total: ${total}\nCost: $${cost}\nTokens: ${tin} in / ${tout} out\nLast run: ${last}`,
    never: "never",
    tableAgents: "id | sessions | running | today | runs | cost",
    tableUsage: "id | today | runs | cost | in/out tokens"
  },
  ru: {
    start: "Привет! Я агент Claude в Telegram. Просто напишите мне сообщение или используйте /new, чтобы начать отдельную сессию в своём топике.",
    startAdmin: "Вы <b>администратор</b> этого бота: /help покажет все команды, включая админские.",
    startLang: "Язык интерфейса можно сменить командой /lang.",
    newDefaultTitle: "Новая сессия",
    newCreated: (title: string) => `Сессия <b>${e(title)}</b> создана. Напишите первое сообщение здесь.`,
    topicsDisabled:
      "Не удалось создать топик: скорее всего, режим топиков отключён для этого бота. Откройте @BotFather, зайдите в настройки бота в его Mini App и включите топики в личных чатах (и разрешите пользователям создавать топики, если хотите делать это сами). Затем повторите /new.",
    sessionsEmpty: "Сессий пока нет. Отправьте сообщение или используйте /new.",
    sessionsHeader: "<b>Сессии</b>",
    sessionLine: (title: string, runs: number, lastUsed: string, current: boolean) =>
      `${current ? "▶ " : "• "}<b>${e(title)}</b> — запусков: ${runs}, последний: ${lastUsed}`,
    stopped: "Остановлено.",
    nothingRunning: "В этой сессии ничего не выполняется.",
    langPrompt: "Выберите язык:",
    langUsage: "Использование: <code>/lang [ru|en]</code>",
    langChanged: "Язык переключён на русский.",
    agentsEmpty: "Агентов пока нет.",
    usageUsage: "Использование: <code>/usage [tgId]</code>",
    tgIdUsage: (cmd: string) => `Использование: <code>/${cmd} &lt;tgId&gt;</code> (числовой Telegram id)`,
    allowed: (id: number) => `Доступ выдан: <code>${id}</code>.`,
    alreadyAllowed: (id: number) => `У <code>${id}</code> уже есть доступ.`,
    revokeAdmin: "Администратора нельзя отозвать.",
    revokeAsk: (id: number) => `Отозвать доступ у <code>${id}</code>?`,
    revoked: (id: number) => `Доступ отозван: <code>${id}</code>.`,
    killAsk: (id: number) => `Убить агента <code>${id}</code>? Запущенные запросы остановятся, контейнер будет уничтожен.`,
    killed: (id: number) => `Агент <code>${id}</code> убит.`,
    restarted: (id: number) => `Агент <code>${id}</code> перезапущен.`,
    cancelled: "Отменено.",
    btnRevoke: "Отозвать",
    btnKill: "Убить",
    btnCancel: "Отмена",
    usageOne: (id: number, today: string, total: number, cost: string, tin: number, tout: number, last: string) =>
      `<b>Агент ${id}</b>\nСегодня: ${today}\nВсего запусков: ${total}\nСтоимость: $${cost}\nТокены: ${tin} вх. / ${tout} исх.\nПоследний запуск: ${last}`,
    never: "никогда",
    tableAgents: "id | сессии | активно | сегодня | запуски | стоимость",
    tableUsage: "id | сегодня | запуски | стоимость | токены вх/исх"
  }
})

export { formatDateTime }
