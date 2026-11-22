import { escapeHtml as e } from "@bot/bot-commands/html"
import { formatDateTime } from "@bot/bot-commands/messages"
import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
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
    limitUsage: "Usage: <code>/limit &lt;tgId&gt; &lt;runs per day | default&gt;</code>",
    limitSet: (id: number, n: number) => `Daily limit for <code>${id}</code>: ${n} requests.`,
    limitReset: (id: number) => `Daily limit for <code>${id}</code> is back to the default.`,
    tgIdUsage: (cmd: string) => `Usage: <code>/${cmd} &lt;tgId&gt;</code> (a numeric Telegram id)`,
    allowed: (id: number) => `Access granted to <code>${id}</code>.`,
    alreadyAllowed: (id: number) => `<code>${id}</code> already has access.`,
    revokeAdmin: "The admin cannot be revoked.",
    revokeAsk: (id: number) => `Revoke access for <code>${id}</code>?`,
    revoked: (id: number) => `Access revoked for <code>${id}</code>.`,
    killAsk: (id: number) =>
      `Kill the agent of <code>${id}</code>? Running requests stop and the container is destroyed.`,
    killed: (id: number) => `Agent <code>${id}</code> killed.`,
    restarted: (id: number) => `Agent <code>${id}</code> restarted.`,
    cancelled: "Cancelled.",
    btnRevoke: "Revoke",
    btnKill: "Kill",
    btnCancel: "Cancel",
    usageOne: (
      id: number,
      who: string,
      today: string,
      total: number,
      cost: string,
      tin: number,
      tout: number,
      last: string
    ) =>
      `<b>Agent ${id}</b> ${e(who)}\nToday: ${today}\nRuns total: ${total}\nCost: $${cost}\nTokens: ${tin} in / ${tout} out\nLast run: ${last}`,
    never: "never",
    tableAgents: "id | user | sessions | running | today | runs | cost",
    tableUsage: "id | user | today | runs | cost | in/out tokens"
  },
  ru: {
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
    limitUsage: "Использование: <code>/limit &lt;tgId&gt; &lt;запусков в день | default&gt;</code>",
    limitSet: (id: number, n: number) => `Дневной лимит для <code>${id}</code>: ${n} запросов.`,
    limitReset: (id: number) => `Дневной лимит для <code>${id}</code> снова общий по умолчанию.`,
    tgIdUsage: (cmd: string) => `Использование: <code>/${cmd} &lt;tgId&gt;</code> (числовой Telegram id)`,
    allowed: (id: number) => `Доступ выдан: <code>${id}</code>.`,
    alreadyAllowed: (id: number) => `У <code>${id}</code> уже есть доступ.`,
    revokeAdmin: "Администратора нельзя отозвать.",
    revokeAsk: (id: number) => `Отозвать доступ у <code>${id}</code>?`,
    revoked: (id: number) => `Доступ отозван: <code>${id}</code>.`,
    killAsk: (id: number) =>
      `Убить агента <code>${id}</code>? Запущенные запросы остановятся, контейнер будет уничтожен.`,
    killed: (id: number) => `Агент <code>${id}</code> убит.`,
    restarted: (id: number) => `Агент <code>${id}</code> перезапущен.`,
    cancelled: "Отменено.",
    btnRevoke: "Отозвать",
    btnKill: "Убить",
    btnCancel: "Отмена",
    usageOne: (
      id: number,
      who: string,
      today: string,
      total: number,
      cost: string,
      tin: number,
      tout: number,
      last: string
    ) =>
      `<b>Агент ${id}</b> ${e(who)}\nСегодня: ${today}\nВсего запусков: ${total}\nСтоимость: $${cost}\nТокены: ${tin} вх. / ${tout} исх.\nПоследний запуск: ${last}`,
    never: "никогда",
    tableAgents: "id | аккаунт | сессии | активно | сегодня | запуски | стоимость",
    tableUsage: "id | аккаунт | сегодня | запуски | стоимость | токены вх/исх"
  }
})

export { formatDateTime }
