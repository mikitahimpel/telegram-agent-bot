import { defineMessages } from "@bot/core-contracts/lang"

export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

export const messages = defineMessages({
  en: {
    description: "Car data: upload, trips, reports",
    usage: "upload [ext] | trips | report [7d|30d|month|YYYY-MM]",
    help:
      "<b>/car</b>\n<code>/car upload [ext]</code> - get an upload link\n<code>/car trips</code> - list trips\n<code>/car report [7d|30d|month|YYYY-MM]</code> - summary for a period",
    badExt: "Extension must be 1-10 letters or digits.",
    badPeriod: "Unknown period. Use <code>7d</code>, <code>30d</code>, <code>month</code> or <code>YYYY-MM</code>.",
    uploadLink: (url: string, minutes: number) =>
      `Upload link (HTTP PUT, valid ${minutes} min):\n<code>${url}</code>`,
    noTrips: "No trips uploaded yet.",
    tripsHeader: (n: number) => `Latest trips (${n}):`,
    reportHeader: (label: string) => `Report for <b>${label}</b>`,
    reportTotals: (count: number, size: string) => `Files: <b>${count}</b>, total size: <b>${size}</b>`,
    reportEmpty: "No files in this period.",
    reportNote: "Detailed metrics (fuel, speed, etc.) need the data file format, which is not defined yet."
  },
  ru: {
    description: "Данные машины: загрузка, поездки, отчёты",
    usage: "upload [ext] | trips | report [7d|30d|month|YYYY-MM]",
    help:
      "<b>/car</b>\n<code>/car upload [ext]</code> - ссылка для загрузки\n<code>/car trips</code> - список поездок\n<code>/car report [7d|30d|month|YYYY-MM]</code> - сводка за период",
    badExt: "Расширение: 1-10 букв или цифр.",
    badPeriod: "Неизвестный период. Используйте <code>7d</code>, <code>30d</code>, <code>month</code> или <code>YYYY-MM</code>.",
    uploadLink: (url: string, minutes: number) =>
      `Ссылка для загрузки (HTTP PUT, действует ${minutes} мин):\n<code>${url}</code>`,
    noTrips: "Поездок пока нет.",
    tripsHeader: (n: number) => `Последние поездки (${n}):`,
    reportHeader: (label: string) => `Отчёт за <b>${label}</b>`,
    reportTotals: (count: number, size: string) => `Файлов: <b>${count}</b>, общий размер: <b>${size}</b>`,
    reportEmpty: "За этот период файлов нет.",
    reportNote: "Подробные метрики (расход, скорость и т.д.) требуют формата файлов данных, он пока не определён."
  }
})

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
