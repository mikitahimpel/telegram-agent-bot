import type { Severity } from "@bot/car-format/insights"

export type Lang = "ru" | "en"

type Subsystem = { readonly en: string; readonly ru: string }

const P_SUBSYSTEMS: Readonly<Record<string, Subsystem>> = {
  "0": { en: "fuel and air metering", ru: "подача топлива и воздуха" },
  "1": { en: "fuel and air metering", ru: "подача топлива и воздуха" },
  "2": { en: "fuel and air metering", ru: "подача топлива и воздуха" },
  "3": { en: "ignition system or misfire", ru: "система зажигания или пропуски зажигания" },
  "4": { en: "auxiliary emission controls", ru: "вспомогательные системы снижения выбросов" },
  "5": { en: "vehicle speed, idle control and inputs", ru: "скорость, холостой ход и входные сигналы" },
  "6": { en: "computer and output circuits", ru: "компьютер и выходные цепи" },
  "7": { en: "transmission", ru: "коробка передач" },
  "8": { en: "transmission", ru: "коробка передач" },
  "9": { en: "transmission", ru: "коробка передач" },
  A: { en: "hybrid or electric propulsion", ru: "гибридная или электрическая силовая установка" },
  B: { en: "hybrid or electric propulsion", ru: "гибридная или электрическая силовая установка" },
  C: { en: "hybrid or electric propulsion", ru: "гибридная или электрическая силовая установка" }
}

const UNKNOWN: Subsystem = { en: "an unspecified system", ru: "неуточнённая система" }

export type GenericInfo = {
  readonly title: string
  readonly meaning: string
  readonly severity: Severity
  readonly canDrive: string
  readonly commonCauses: ReadonlyArray<string>
  readonly whatToDo: string
}

const DRIVE_EN =
  "Usually you can drive carefully to a service. Stop if the engine runs rough, warning lights flash, the temperature rises or the car loses power."
const DRIVE_RU =
  "Обычно можно аккуратно доехать до сервиса. Остановитесь, если двигатель трясётся, мигают индикаторы, растёт температура или пропадает мощность."

const ADVICE_EN =
  "Do not clear the code before diagnosis: the stored data helps the mechanic. "
const ADVICE_RU =
  "Не стирайте ошибку до диагностики: сохранённые данные помогают мастеру. "

const MANUFACTURER_EN =
  "The exact meaning of this code depends on the car make: read it with a make-specific scan tool or tell the mechanic the code."
const MANUFACTURER_RU =
  "Точное значение этого кода зависит от марки автомобиля: считайте его сканером для вашей марки или назовите код мастеру."

const GENERIC_EN =
  "This is a standard code, but it is not in our list: look it up for your car or ask a mechanic to read it with a scanner."
const GENERIC_RU =
  "Это стандартный код, но его нет в нашем списке: уточните его для вашей машины или попросите мастера считать его сканером."

const texts = (lang: Lang) =>
  lang === "ru"
    ? { drive: DRIVE_RU, advice: ADVICE_RU, manufacturer: MANUFACTURER_RU, generic: GENERIC_RU }
    : { drive: DRIVE_EN, advice: ADVICE_EN, manufacturer: MANUFACTURER_EN, generic: GENERIC_EN }

const CAUSES: Readonly<Record<"p" | "b" | "c" | "u", Record<Lang, ReadonlyArray<string>>>> = {
  p: {
    en: ["Failing sensor, actuator or valve", "Wiring or connector fault", "Low battery voltage", "Mechanical wear in the affected system"],
    ru: ["Неисправный датчик, привод или клапан", "Неисправность проводки или разъёма", "Низкое напряжение аккумулятора", "Механический износ в затронутой системе"]
  },
  b: {
    en: ["Failing sensor or switch in the body electronics", "Wiring or connector fault", "Low battery voltage", "Fault in the control module"],
    ru: ["Неисправный датчик или выключатель кузовной электроники", "Неисправность проводки или разъёма", "Низкое напряжение аккумулятора", "Неисправность блока управления"]
  },
  c: {
    en: ["Failing wheel speed or steering sensor", "Wiring or connector fault", "Low battery voltage", "Fault in the brake or suspension control module"],
    ru: ["Неисправный датчик скорости колеса или руля", "Неисправность проводки или разъёма", "Низкое напряжение аккумулятора", "Неисправность блока тормозной системы или подвески"]
  },
  u: {
    en: ["Low battery voltage", "Damaged network wiring or connector", "A control module that is not answering", "Software mismatch after repair"],
    ru: ["Низкое напряжение аккумулятора", "Повреждённая проводка или разъём сети", "Блок управления, который не отвечает", "Несовпадение программного обеспечения после ремонта"]
  }
}

export const genericGroupText = (code: string, lang: Lang): GenericInfo => {
  const t = texts(lang)
  const letter = code.charAt(0)
  const digit = code.charAt(1)
  const sub = letter === "P" ? (P_SUBSYSTEMS[code.charAt(2)] ?? UNKNOWN) : UNKNOWN
  const sensor = lang === "ru" ? sub.ru : sub.en
  const manufacturer = digit === "1" || digit === "3" || (letter === "U" && digit !== "0")
  if (letter === "P") {
    const causes = CAUSES.p[lang]
    if (manufacturer) {
      return {
        title: lang === "ru" ? `Код производителя ${code}: ${sensor}` : `Manufacturer-specific code ${code}: ${sensor}`,
        meaning:
          lang === "ru"
            ? `Код ${code} относится к силовой установке (${sensor}). Это код, который определяет производитель автомобиля.`
            : `Code ${code} relates to the powertrain (${sensor}). It is defined by the car manufacturer.`,
        severity: "watch",
        canDrive: t.drive,
        commonCauses: causes,
        whatToDo: t.advice + t.manufacturer
      }
    }
    return {
      title: lang === "ru" ? `Стандартный код ${code}: ${sensor}` : `Generic code ${code}: ${sensor}`,
      meaning:
        lang === "ru"
          ? `Код ${code} относится к силовой установке (${sensor}). Это стандартный код, но подробного описания в нашем списке нет.`
          : `Code ${code} relates to the powertrain (${sensor}). It is a standard code, but our list has no detailed description for it.`,
      severity: "watch",
      canDrive: t.drive,
      commonCauses: causes,
      whatToDo: t.advice + t.generic
    }
  }
  if (letter === "B") {
    return {
      title: lang === "ru" ? `Код кузова ${code}` : `Body code ${code}`,
      meaning:
        lang === "ru"
          ? `Код ${code} относится к кузовной электронике (двери, свет, подушки безопасности, климат, комфорт).`
          : `Code ${code} relates to body electronics (doors, lights, airbags, climate, comfort).`,
      severity: "watch",
      canDrive: t.drive,
      commonCauses: CAUSES.b[lang],
      whatToDo: t.advice + (lang === "ru" ? "Если код связан с подушками безопасности, не откладывайте проверку. " : "If it concerns airbags, do not postpone the check. ") + t.manufacturer
    }
  }
  if (letter === "C") {
    return {
      title: lang === "ru" ? `Код шасси ${code}` : `Chassis code ${code}`,
      meaning:
        lang === "ru"
          ? `Код ${code} относится к шасси (тормоза, ABS, подвеска, рулевое управление).`
          : `Code ${code} relates to the chassis (brakes, ABS, suspension, steering).`,
      severity: "watch",
      canDrive: t.drive,
      commonCauses: CAUSES.c[lang],
      whatToDo: t.advice + (lang === "ru" ? "Если тормоза ведут себя странно, не продолжайте движение. " : "If the brakes feel odd, do not keep driving. ") + t.manufacturer
    }
  }
  if (letter === "U") {
    return {
      title:
        manufacturer
          ? lang === "ru" ? `Код сети производителя ${code}` : `Manufacturer-specific network code ${code}`
          : lang === "ru" ? `Код сети связи ${code}` : `Network communication code ${code}`,
      meaning:
        lang === "ru"
          ? `Код ${code} относится к связи между блоками управления автомобиля.`
          : `Code ${code} relates to communication between the car's control modules.`,
      severity: "watch",
      canDrive: t.drive,
      commonCauses: CAUSES.u[lang],
      whatToDo:
        t.advice +
        (lang === "ru"
          ? "Сначала проверьте аккумулятор и клеммы: низкое напряжение часто вызывает такие ошибки. "
          : "First check the battery and its terminals: low voltage often causes such codes. ") +
        (manufacturer ? t.manufacturer : t.generic)
    }
  }
  return {
    title: lang === "ru" ? `Неопознанный код ${code}` : `Unrecognised code ${code}`,
    meaning: lang === "ru" ? "Формат кода не распознан." : "The code format is not recognised.",
    severity: "info",
    canDrive: t.drive,
    commonCauses: [],
    whatToDo: t.advice + t.manufacturer
  }
}
