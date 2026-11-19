import { defineMessages } from "@bot/core-contracts/lang"
import type { Lang } from "@bot/core-contracts/lang"

export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

export const messages = defineMessages({
  en: {
    description: "Car: app, trips, reports",
    usage: "app | trips | report [7d|30d|month|YYYY-MM] | devices | upload [ext]",
    help:
      "<b>/car</b>\n<code>/car app</code> - open the car app\n<code>/car trips</code> - list trips\n<code>/car report [7d|30d|month|YYYY-MM]</code> - metrics for a period\n<code>/car devices</code> - connected phones\n<code>/car upload [ext]</code> - raw file upload link\nYou can also send a trip <code>.csv</code> file to this chat to import it.",
    appText: "Tap the button to connect the recorder. Open it in Chrome on Android (Bluetooth does not work inside Telegram). The link is one-time and valid for 30 minutes.",
    openApp: "Open recorder",
    appNotConfigured: "The car app address is not configured yet. Ask the admin.",
    badExt: "Extension must be 1-10 letters or digits.",
    badPeriod: "Unknown period. Use <code>7d</code>, <code>30d</code>, <code>month</code> or <code>YYYY-MM</code>.",
    uploadLink: (url: string, minutes: number) =>
      `The app is the primary way to upload trips (<code>/car app</code>). For a raw file, use this link (HTTP PUT, valid ${minutes} min):\n<code>${url}</code>`,
    noTrips: "No trips yet. Open the app with /car app to record one.",
    tripsHeader: (n: number) => `Latest trips (${n}):`,
    tripOk: (date: string, duration: string, points: number) => `✅ ${date} - ${duration} - ${points} pts`,
    tripPartial: (date: string, got: number, total: number) => `⚠️ ${date} - ${got}/${total} parts`,
    tripRecording: (date: string) => `⏺ ${date} - still recording or not finished`,
    reportHeader: (label: string) => `Report for <b>${label}</b>`,
    reportEmpty: "No complete trips in this period.",
    reportColumns: "Trip|Time|km|Avg|Max|L/100",
    reportTotal: "Total",
    reportSummary: (trips: number, duration: string, km: string, idle: string, fuel: string, coolant: string) =>
      `Trips: <b>${trips}</b>, time: <b>${duration}</b>, distance: <b>${km}</b>\nIdle: ${idle}${fuel}${coolant}`,
    reportFuel: (liters: string) => `, fuel: ${liters}`,
    reportCoolant: (c: string) => `, avg coolant: ${c}`,
    reportEstimate: "Fuel is an estimate (from the air flow sensor), not a direct reading.",
    reportSkipped: (n: number) => `${n} incomplete trip(s) are not included; open the app to finish uploading them.`,
    reportTruncated: (n: number) => `Only the latest ${n} trips are shown.`,
    devicesNone: "No phones are connected. Use /car app to connect one.",
    devicesHeader: (n: number) => `Connected phones (${n}):`,
    deviceLine: (name: string, created: string, seen: string) => `📱 <b>${name}</b> - connected ${created}, last seen ${seen}`,
    deviceNever: "never",
    revoke: (name: string) => `Disconnect ${name}`,
    revoked: "Disconnected",
    revokeNotFound: "Already disconnected",
    importOk: (date: string, duration: string, distance: string, points: number) =>
      `✅ file imported: ${date}, ${duration}${distance}, ${points} points`,
    importDistance: (km: string) => `, ${km}`,
    importTooBig: "The file is larger than 20 MB. Split it or upload via the app.",
    importDownload: "Could not download the file from Telegram. Try sending it again.",
    importBad: (line: number, msg: string) => `The file is not a valid trip CSV: line ${line}: ${msg}`,
    importEmpty: "The file has a header but no data rows.",
    importStorage: "Could not save the trip. Try again later."
  },
  ru: {
    description: "Машина: приложение, поездки, отчёты",
    usage: "app | trips | report [7d|30d|month|YYYY-MM] | devices | upload [ext]",
    help:
      "<b>/car</b>\n<code>/car app</code> - открыть приложение\n<code>/car trips</code> - список поездок\n<code>/car report [7d|30d|month|YYYY-MM]</code> - метрики за период\n<code>/car devices</code> - подключённые телефоны\n<code>/car upload [ext]</code> - ссылка для загрузки файла\nМожно также отправить в чат <code>.csv</code> файл поездки - он будет импортирован.",
    appText: "Нажмите кнопку, чтобы подключить рекордер. Открывайте в Chrome на Android (внутри Telegram Bluetooth не работает). Ссылка одноразовая и действует 30 минут.",
    openApp: "Открыть рекордер",
    appNotConfigured: "Адрес приложения ещё не настроен. Обратитесь к администратору.",
    badExt: "Расширение: 1-10 букв или цифр.",
    badPeriod: "Неизвестный период. Используйте <code>7d</code>, <code>30d</code>, <code>month</code> или <code>YYYY-MM</code>.",
    uploadLink: (url: string, minutes: number) =>
      `Основной способ загрузки поездок - приложение (<code>/car app</code>). Для произвольного файла используйте ссылку (HTTP PUT, действует ${minutes} мин):\n<code>${url}</code>`,
    noTrips: "Поездок пока нет. Откройте приложение через /car app, чтобы записать.",
    tripsHeader: (n: number) => `Последние поездки (${n}):`,
    tripOk: (date: string, duration: string, points: number) => `✅ ${date} - ${duration} - ${points} точек`,
    tripPartial: (date: string, got: number, total: number) => `⚠️ ${date} - ${got}/${total} частей`,
    tripRecording: (date: string) => `⏺ ${date} - запись идёт или не завершена`,
    reportHeader: (label: string) => `Отчёт за <b>${label}</b>`,
    reportEmpty: "За этот период нет полностью загруженных поездок.",
    reportColumns: "Поездка|Время|км|Ср.|Макс.|л/100",
    reportTotal: "Итого",
    reportSummary: (trips: number, duration: string, km: string, idle: string, fuel: string, coolant: string) =>
      `Поездок: <b>${trips}</b>, время: <b>${duration}</b>, путь: <b>${km}</b>\nПростой: ${idle}${fuel}${coolant}`,
    reportFuel: (liters: string) => `, топливо: ${liters}`,
    reportCoolant: (c: string) => `, средняя t° ОЖ: ${c}`,
    reportEstimate: "Расход - оценка (по датчику массового расхода воздуха), а не прямое измерение.",
    reportSkipped: (n: number) => `Не учтено неполных поездок: ${n}. Откройте приложение, чтобы дозагрузить.`,
    reportTruncated: (n: number) => `Показаны только последние ${n} поездок.`,
    devicesNone: "Подключённых телефонов нет. Используйте /car app, чтобы подключить.",
    devicesHeader: (n: number) => `Подключённые телефоны (${n}):`,
    deviceLine: (name: string, created: string, seen: string) => `📱 <b>${name}</b> - подключён ${created}, был в сети ${seen}`,
    deviceNever: "никогда",
    revoke: (name: string) => `Отключить ${name}`,
    revoked: "Отключено",
    revokeNotFound: "Уже отключено",
    importOk: (date: string, duration: string, distance: string, points: number) =>
      `✅ файл импортирован: ${date}, ${duration}${distance}, ${points} точек`,
    importDistance: (km: string) => `, ${km}`,
    importTooBig: "Файл больше 20 МБ. Разделите его или загрузите через приложение.",
    importDownload: "Не удалось скачать файл из Telegram. Отправьте его ещё раз.",
    importBad: (line: number, msg: string) => `Файл не является корректным CSV поездки: строка ${line}: ${msg}`,
    importEmpty: "В файле есть заголовок, но нет строк с данными.",
    importStorage: "Не удалось сохранить поездку. Попробуйте позже."
  }
})

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const formatDuration = (seconds: number, lang: Lang): string => {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const [hu, mu, su] = lang === "ru" ? ["ч", "мин", "с"] : ["h", "min", "s"]
  if (h > 0) return `${h} ${hu} ${String(m).padStart(2, "0")} ${mu}`
  if (m > 0) return `${m} ${mu}`
  return `${total} ${su}`
}

export const formatKm = (km: number | undefined, lang: Lang): string =>
  km === undefined ? "-" : `${km.toFixed(km < 10 ? 1 : 0)} ${lang === "ru" ? "км" : "km"}`

export const formatStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ")
