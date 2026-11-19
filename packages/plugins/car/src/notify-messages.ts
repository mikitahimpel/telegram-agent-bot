import { defineMessages } from "@bot/core-contracts/lang"

export const notifyMessages = defineMessages({
  en: {
    tripHeader: (date: string, duration: string, km: string) => `🚗 <b>Trip finished</b>: ${date}, ${duration}, ${km}`,
    speed: (avg: string, max: string) => `Average speed ${avg} km/h, top speed ${max} km/h.`,
    fuel: (per100: string, estimate: boolean) => `⛽ Fuel: <b>${per100} L/100 km</b>${estimate ? " (estimate)" : ""}`,
    fuelUsual: (usual: string, deltaPct: number) =>
      Math.abs(deltaPct) < 10
        ? `, about your usual (${usual})`
        : deltaPct > 0
          ? `, <b>+${Math.round(deltaPct)}%</b> above your usual ${usual}`
          : `, <b>${Math.round(deltaPct)}%</b> below your usual ${usual}`,
    notableHeader: "Worth knowing:",
    hardEvents: (n: number) => `${n} hard accelerations or brakings`,
    hot: (c: number) => `the engine reached ${c} °C`,
    idling: (pct: number) => `the engine idled ${pct}% of the time`,
    openTrip: "Open trip details",
    openEngine: "Open engine",
    openBattery: "Open battery",
    openStats: "Open statistics",
    openOverview: "Open overview",
    severity: (s: "info" | "watch" | "soon" | "urgent"): string =>
      s === "urgent" ? "🚨 <b>URGENT</b>" : s === "soon" ? "⚠️ <b>Needs attention soon</b>" : s === "watch" ? "🔎 <b>Keep an eye on it</b>" : "ℹ️",
    alertBody: (sev: string, title: string, details: string, todo: string) =>
      `${sev}\n<b>${title}</b>\n${details}\n\n<b>What to do:</b> ${todo}`,
    newCodes: (n: number) => (n === 1 ? "New fault code from the car" : `New fault codes from the car: ${n}`),
    codeBlock: (code: string, title: string, meaning: string, canDrive: string, todo: string) =>
      `<b>${code}</b>: ${title}\n${meaning}\n<b>Can I drive?</b> ${canDrive}\n<b>What to do:</b> ${todo}`,
    moreCodes: (n: number) => `And ${n} more, see the Engine section.`,
    weeklyHeader: "📊 <b>Your car this week</b>",
    weeklyNoTrips: "No trips recorded in the last 7 days.",
    weeklyTrips: (n: number, prev: number, km: string, prevKm: string) => `Trips: <b>${n}</b> (week before: ${prev}), distance <b>${km}</b> (week before: ${prevKm})`,
    weeklyFuel: (per100: string, prev: string) => `Fuel: <b>${per100} L/100 km</b> (week before: ${prev})`,
    weeklyIdle: (pct: number) => `Idling: ${pct}% of driving time`,
    weeklyHard: (n: number) => `Hard accelerations and brakings: ${n}`,
    weeklyHot: (c: number) => `Hottest the engine got: ${c} °C`,
    weeklyBattery: (status: "good" | "watch" | "weak" | "unknown", v: string) =>
      status === "unknown"
        ? "Battery: no reading yet"
        : `Battery: ${status === "good" ? "good" : status === "watch" ? "getting weak" : "weak"}${v === "" ? "" : `, ${v} V at rest`}`,
    weeklyCodes: (n: number) => (n === 0 ? "Engine: no fault codes" : `Engine: ${n} active fault code${n === 1 ? "" : "s"}`),
    weeklyAlerts: "Open alerts:",
    weeklyNone: "no open alerts",
    none: "-"
  },
  ru: {
    tripHeader: (date: string, duration: string, km: string) => `🚗 <b>Поездка завершена</b>: ${date}, ${duration}, ${km}`,
    speed: (avg: string, max: string) => `Средняя скорость ${avg} км/ч, максимальная ${max} км/ч.`,
    fuel: (per100: string, estimate: boolean) => `⛽ Расход: <b>${per100} л/100 км</b>${estimate ? " (оценка)" : ""}`,
    fuelUsual: (usual: string, deltaPct: number) =>
      Math.abs(deltaPct) < 10
        ? `, примерно как обычно (${usual})`
        : deltaPct > 0
          ? `, <b>на ${Math.round(deltaPct)}% выше</b> обычного ${usual}`
          : `, <b>на ${Math.abs(Math.round(deltaPct))}% ниже</b> обычного ${usual}`,
    notableHeader: "Что заметно:",
    hardEvents: (n: number) => `резких разгонов и торможений: ${n}`,
    hot: (c: number) => `двигатель нагревался до ${c} °C`,
    idling: (pct: number) => `двигатель простаивал ${pct}% времени`,
    openTrip: "Открыть детали поездки",
    openEngine: "Открыть двигатель",
    openBattery: "Открыть аккумулятор",
    openStats: "Открыть статистику",
    openOverview: "Открыть обзор",
    severity: (s: "info" | "watch" | "soon" | "urgent"): string =>
      s === "urgent" ? "🚨 <b>СРОЧНО</b>" : s === "soon" ? "⚠️ <b>Нужно разобраться в ближайшее время</b>" : s === "watch" ? "🔎 <b>Понаблюдайте</b>" : "ℹ️",
    alertBody: (sev: string, title: string, details: string, todo: string) => `${sev}\n<b>${title}</b>\n${details}\n\n<b>Что делать:</b> ${todo}`,
    newCodes: (n: number) => (n === 1 ? "Новый код ошибки от автомобиля" : `Новые коды ошибок от автомобиля: ${n}`),
    codeBlock: (code: string, title: string, meaning: string, canDrive: string, todo: string) =>
      `<b>${code}</b>: ${title}\n${meaning}\n<b>Можно ли ехать?</b> ${canDrive}\n<b>Что делать:</b> ${todo}`,
    moreCodes: (n: number) => `И ещё ${n}, смотрите раздел «Двигатель».`,
    weeklyHeader: "📊 <b>Ваша машина за неделю</b>",
    weeklyNoTrips: "За последние 7 дней поездок не записано.",
    weeklyTrips: (n: number, prev: number, km: string, prevKm: string) => `Поездок: <b>${n}</b> (неделей раньше: ${prev}), путь <b>${km}</b> (неделей раньше: ${prevKm})`,
    weeklyFuel: (per100: string, prev: string) => `Расход: <b>${per100} л/100 км</b> (неделей раньше: ${prev})`,
    weeklyIdle: (pct: number) => `Простой: ${pct}% времени в пути`,
    weeklyHard: (n: number) => `Резких разгонов и торможений: ${n}`,
    weeklyHot: (c: number) => `Максимальная температура двигателя: ${c} °C`,
    weeklyBattery: (status: "good" | "watch" | "weak" | "unknown", v: string) =>
      status === "unknown"
        ? "Аккумулятор: измерений пока нет"
        : `Аккумулятор: ${status === "good" ? "в порядке" : status === "watch" ? "начинает садиться" : "слабый"}${v === "" ? "" : `, ${v} В в покое`}`,
    weeklyCodes: (n: number) => (n === 0 ? "Двигатель: кодов ошибок нет" : `Двигатель: активных кодов ошибок ${n}`),
    weeklyAlerts: "Открытые предупреждения:",
    weeklyNone: "открытых предупреждений нет",
    none: "-"
  }
})
