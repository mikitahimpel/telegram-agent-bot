import type { Severity } from "@bot/car-format/insights"
import { defineMessages, type Lang } from "@bot/core-contracts/lang"

type Ev = Readonly<Record<string, number>>

const v = (x: number | undefined, d = 2) => (x === undefined ? "?" : x.toFixed(d))
const vr = (x: number | undefined, d = 2) => v(x, d).replace(".", ",")

export const renderMessages = defineMessages({
  en: {
    batteryTitle: (sev: Severity): string => (sev === "watch" ? "The battery is getting weak" : "The battery is weak"),
    batteryDetails: (e: Ev) =>
      [
        e["restingV"] !== undefined
          ? `Voltage with the engine off was ${v(e["restingV"])} V (a healthy battery shows about 12.4 to 12.7 V).`
          : "",
        e["crankMinV"] !== undefined
          ? `The lowest voltage while starting was ${v(e["crankMinV"])} V (a healthy battery stays above about 9.6 V).`
          : ""
      ]
        .filter((s) => s !== "")
        .join(" "),
    batteryTodo:
      "Have the battery tested at a garage or parts shop (usually free) in the next week or two. If it is 4 to 5 years old, plan a replacement. Long drives help it recharge; many short trips do not.",
    chargingLowTitle: "The battery is not charging well while driving",
    chargingHighTitle: "The charging voltage is too high",
    chargingDetails: (e: Ev) =>
      `Average voltage while driving was ${v(e["chargingAvgV"])} V` +
      (e["chargingMinV"] !== undefined && e["chargingMaxV"] !== undefined ? ` (from ${v(e["chargingMinV"])} to ${v(e["chargingMaxV"])} V)` : "") +
      `. Normal is about 13.8 to 14.5 V.`,
    chargingLowTodo:
      "The alternator, its belt or the wiring may be at fault. Do not wait: have it checked this week, because the battery will drain and the car can stop. Turn off heating, seat heating and music to save power until then.",
    chargingHighTodo:
      "Too high a voltage can boil the battery and damage electronics. Have the alternator regulator checked as soon as possible and avoid long drives.",
    overheatingTitle: "The engine got too hot",
    overheatingDetails: (e: Ev) => `The coolant reached ${v(e["maxCoolantC"], 0)} °C (normal is 85 to 100 °C).`,
    overheatingTodo:
      "If the temperature gauge goes into the red, stop safely and switch the engine off. Do not open the cap on a hot engine. Check the coolant level when cool and have the cooling system (thermostat, fan, leaks) checked before further driving.",
    warmupTitle: "The engine warms up slowly",
    warmupDetails: (e: Ev) =>
      e["warmupS"] !== undefined
        ? `Starting from ${v(e["startCoolantC"], 0)} °C the coolant needed ${Math.round((e["warmupS"] as number) / 60)} min to reach 70 °C (usually 5 to 10 min).`
        : `Starting from ${v(e["startCoolantC"], 0)} °C the coolant did not reach 70 °C in ${Math.round((e["observedS"] ?? 0) / 60)} min of driving, its maximum was ${v(e["maxCoolantC"], 0)} °C.`,
    warmupTodo:
      "Very cold weather and short city trips slow warm-up. If it repeats in mild weather, the thermostat is probably stuck open: it raises fuel use and wear. Have it checked at the next service.",
    fuelTitle: "Fuel consumption went up",
    fuelDetails: (e: Ev) =>
      `This trip used ${v(e["fuelPer100Km"], 1)} L/100 km, while your usual at similar speeds over the last 30 days is ${v(e["medianPer100Km"], 1)} L/100 km (+${v(e["deltaPct"], 0)}%).`,
    fuelTodo:
      "Check tyre pressure first, then roof racks or extra load, and whether you drove more aggressively or in the cold. If it stays high for several trips, have the air filter, spark plugs and oxygen sensors checked.",
    lowFuelTitle: "The fuel level is low",
    lowFuelDetails: (e: Ev) => `The tank was at about ${v(e["fuelLevelPct"], 0)}% at the end of the trip.`,
    lowFuelTodo: "Refuel soon. Running the tank nearly empty can damage the fuel pump.",
    checkTitle: (sev: Severity): string => (sev === "urgent" ? "Check engine: serious fault" : "Check engine light or fault codes"),
    checkDetails: (e: Ev, codes: string) =>
      (e["milOn"] === 1 ? "The check engine light is on. " : "") +
      (e["codes"] ? `Fault codes: ${codes || e["codes"]}.` : "The car reports no specific codes."),
    checkTodo:
      "Open the Engine section for the explanation of each code. Do not clear the codes before a diagnosis. If the light flashes, the engine runs roughly or the temperature rises, stop driving and call a service."
  },
  ru: {
    batteryTitle: (sev: Severity): string => (sev === "watch" ? "Аккумулятор начинает садиться" : "Аккумулятор слабый"),
    batteryDetails: (e: Ev) =>
      [
        e["restingV"] !== undefined
          ? `Напряжение при заглушенном двигателе было ${vr(e["restingV"])} В (у здорового аккумулятора около 12,4-12,7 В).`
          : "",
        e["crankMinV"] !== undefined
          ? `Минимальное напряжение при запуске было ${vr(e["crankMinV"])} В (у здорового не опускается ниже примерно 9,6 В).`
          : ""
      ]
        .filter((s) => s !== "")
        .join(" "),
    batteryTodo:
      "Проверьте аккумулятор в сервисе или магазине автозапчастей (обычно бесплатно) в ближайшие одну-две недели. Если ему 4-5 лет, готовьтесь к замене. Длинные поездки подзаряжают его, короткие частые - нет.",
    chargingLowTitle: "Аккумулятор плохо заряжается во время езды",
    chargingHighTitle: "Слишком высокое напряжение зарядки",
    chargingDetails: (e: Ev) =>
      `Среднее напряжение в движении было ${v(e["chargingAvgV"]).replace(".", ",")} В` +
      (e["chargingMinV"] !== undefined && e["chargingMaxV"] !== undefined
        ? ` (от ${v(e["chargingMinV"]).replace(".", ",")} до ${v(e["chargingMaxV"]).replace(".", ",")} В)`
        : "") +
      `. Норма около 13,8-14,5 В.`,
    chargingLowTodo:
      "Возможна неисправность генератора, его ремня или проводки. Не откладывайте: проверьте на этой неделе, иначе аккумулятор разрядится и машина может встать. До тех пор выключайте обогрев, подогрев сидений и музыку.",
    chargingHighTodo:
      "Слишком высокое напряжение может закипятить аккумулятор и повредить электронику. Как можно скорее проверьте реле-регулятор генератора и избегайте дальних поездок.",
    overheatingTitle: "Двигатель перегрелся",
    overheatingDetails: (e: Ev) => `Охлаждающая жидкость достигла ${v(e["maxCoolantC"], 0)} °C (норма 85-100 °C).`,
    overheatingTodo:
      "Если стрелка температуры уходит в красную зону, безопасно остановитесь и заглушите двигатель. Не открывайте крышку на горячем двигателе. Когда остынет, проверьте уровень жидкости и проверьте систему охлаждения (термостат, вентилятор, утечки) до дальнейших поездок.",
    warmupTitle: "Двигатель медленно прогревается",
    warmupDetails: (e: Ev) =>
      e["warmupS"] !== undefined
        ? `Начав с ${v(e["startCoolantC"], 0)} °C, жидкость набирала 70 °C ${Math.round((e["warmupS"] as number) / 60)} мин (обычно 5-10 мин).`
        : `Начав с ${v(e["startCoolantC"], 0)} °C, жидкость не дошла до 70 °C за ${Math.round((e["observedS"] ?? 0) / 60)} мин движения, максимум был ${v(e["maxCoolantC"], 0)} °C.`,
    warmupTodo:
      "Сильный мороз и короткие городские поездки замедляют прогрев. Если это повторяется в тёплую погоду, вероятно, термостат застрял в открытом положении: растут расход и износ. Покажите машину на ближайшем обслуживании.",
    fuelTitle: "Расход топлива вырос",
    fuelDetails: (e: Ev) =>
      `В этой поездке расход был ${v(e["fuelPer100Km"], 1).replace(".", ",")} л/100 км, а обычно на похожих скоростях за последние 30 дней ${v(e["medianPer100Km"], 1).replace(".", ",")} л/100 км (+${v(e["deltaPct"], 0)}%).`,
    fuelTodo:
      "Сначала проверьте давление в шинах, затем багажник на крыше или лишний груз, и не ехали ли вы агрессивнее или на морозе. Если расход остаётся высоким несколько поездок, проверьте воздушный фильтр, свечи и датчики кислорода.",
    lowFuelTitle: "Мало топлива",
    lowFuelDetails: (e: Ev) => `В конце поездки в баке было около ${v(e["fuelLevelPct"], 0)}%.`,
    lowFuelTodo: "Заправьтесь в ближайшее время. Езда на почти пустом баке может повредить топливный насос.",
    checkTitle: (sev: Severity): string => (sev === "urgent" ? "Check engine: серьёзная неисправность" : "Горит Check engine или есть коды ошибок"),
    checkDetails: (e: Ev, codes: string) =>
      (e["milOn"] === 1 ? "Горит лампа Check engine. " : "") +
      (e["codes"] ? `Коды ошибок: ${codes || e["codes"]}.` : "Автомобиль не сообщает конкретных кодов."),
    checkTodo:
      "Откройте раздел «Двигатель»: там объяснение каждого кода. Не сбрасывайте коды до диагностики. Если лампа мигает, двигатель работает неровно или растёт температура, прекратите движение и вызовите эвакуатор или сервис."
  }
})

export type RenderedAlert = { readonly title: string; readonly details: string; readonly whatToDo: string }

export const renderAlert = (
  dedupKey: string,
  severity: Severity,
  evidence: Ev,
  lang: Lang,
  codes: string = ""
): RenderedAlert => {
  const m = renderMessages[lang]
  switch (dedupKey) {
    case "battery_weak":
      return { title: m.batteryTitle(severity), details: m.batteryDetails(evidence), whatToDo: m.batteryTodo }
    case "charging_problem:low":
      return { title: m.chargingLowTitle, details: m.chargingDetails(evidence), whatToDo: m.chargingLowTodo }
    case "charging_problem:high":
      return { title: m.chargingHighTitle, details: m.chargingDetails(evidence), whatToDo: m.chargingHighTodo }
    case "overheating":
      return { title: m.overheatingTitle, details: m.overheatingDetails(evidence), whatToDo: m.overheatingTodo }
    case "slow_warmup":
      return { title: m.warmupTitle, details: m.warmupDetails(evidence), whatToDo: m.warmupTodo }
    case "fuel_consumption_up":
      return { title: m.fuelTitle, details: m.fuelDetails(evidence), whatToDo: m.fuelTodo }
    case "low_fuel":
      return { title: m.lowFuelTitle, details: m.lowFuelDetails(evidence), whatToDo: m.lowFuelTodo }
    default:
      return { title: m.checkTitle(severity), details: m.checkDetails(evidence, codes), whatToDo: m.checkTodo }
  }
}
