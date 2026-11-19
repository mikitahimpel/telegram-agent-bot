import { defineMessages } from "@bot/core-contracts/lang"

export const messages = defineMessages({
  en: {
    tripSaved: (date: string, duration: string, distance: string, points: number) =>
      `✅ trip saved: ${date}, ${duration}${distance}, ${points} pts`,
    distance: (km: string) => `, ${km}`,
    tripPartial: (got: number, total: number, missing: string) =>
      `⚠️ trip uploaded partially: ${got} of ${total} parts, missing ${missing}; open the app to resend`,
    openApp: "Open recorder",
    newDevice: (name: string) => `New device connected: <b>${name}</b>. If this was not you, disconnect it.`,
    revoke: (name: string) => `Disconnect ${name}`,
    unauthorized: "Authorization is missing or expired. Reopen the app from the bot.",
    pairInvalid: "The pairing link has expired or was already used. Get a new one with /car app in the bot.",
    forbidden: "This account is not allowed to use the bot.",
    pluginDisabled: "The car plugin is not enabled for your account. Ask the admin.",
    badRequest: (why: string) => `Bad request: ${why}`,
    checksum: "The upload was corrupted in transit (checksum mismatch). Retry.",
    conflict: "A different version of this part is already stored. It is never overwritten.",
    tooLarge: "The request body is too large.",
    notFound: "Not found.",
    rateLimited: "Too many requests. Retry in a minute.",
    internal: "Server error. Retry later."
  },
  ru: {
    tripSaved: (date: string, duration: string, distance: string, points: number) =>
      `✅ поездка сохранена: ${date}, ${duration}${distance}, ${points} точек`,
    distance: (km: string) => `, ${km}`,
    tripPartial: (got: number, total: number, missing: string) =>
      `⚠️ поездка загружена частично: ${got} из ${total} частей, не хватает ${missing}; откройте приложение, чтобы дослать`,
    openApp: "Открыть рекордер",
    newDevice: (name: string) => `Подключено новое устройство: <b>${name}</b>. Если это были не вы, отключите его.`,
    revoke: (name: string) => `Отключить ${name}`,
    unauthorized: "Авторизация отсутствует или истекла. Откройте приложение из бота заново.",
    pairInvalid: "Ссылка подключения устарела или уже использована. Получите новую командой /car app в боте.",
    forbidden: "Этому аккаунту не разрешено пользоваться ботом.",
    pluginDisabled: "Плагин машины не включён для вашего аккаунта. Обратитесь к администратору.",
    badRequest: (why: string) => `Некорректный запрос: ${why}`,
    checksum: "Данные повреждены при передаче (не совпала контрольная сумма). Повторите отправку.",
    conflict: "Другая версия этой части уже сохранена. Она никогда не перезаписывается.",
    tooLarge: "Тело запроса слишком большое.",
    notFound: "Не найдено.",
    rateLimited: "Слишком много запросов. Повторите через минуту.",
    internal: "Ошибка сервера. Повторите позже."
  }
})
