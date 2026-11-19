import type { Alert, CarOverview, DtcExplanation, PeriodStats, TripInsight, TripSeries } from "@bot/car-format/insights"
import type { Lang } from "../i18n/format.ts"

const DAY = 86_400_000
const STEP_S = 4

export const DEMO_TRIP_ID = "20261119T100000Z-ab12cd34"

export type InsightScenario = "issues" | "healthy"

const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const rng = (seed: number) => {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d

export type TripShape = { tripId: string; startedAt: number; durationS: number }

type Variant = { fuel: boolean; estimate: boolean; gapAtS: number | null }

const variantOf = (tripId: string): Variant => {
  if (tripId.includes("ee55aa01")) return { fuel: false, estimate: true, gapAtS: null }
  if (tripId.includes("0f0f0f0f")) return { fuel: true, estimate: false, gapAtS: null }
  return { fuel: true, estimate: true, gapAtS: tripId.startsWith("demo-") ? null : 600 }
}

const GEAR_THRESHOLDS = [15, 30, 50, 75] as const
const GEAR_RATIO = [95, 60, 42, 32, 26] as const

const buildSeries = (shape: TripShape): TripSeries => {
  const random = rng(hash(shape.tripId))
  const variant = variantOf(shape.tripId)
  const n = Math.floor(shape.durationS / STEP_S)
  const ts: number[] = []
  const cols: Record<string, (number | null)[]> = {
    speed_kmh: [],
    rpm: [],
    coolant_c: [],
    fuel_rate_lph: [],
    voltage_v: [],
    lat: [],
    lon: []
  }
  const gaps: { from: number; to: number }[] = []
  const gapStart = variant.gapAtS === null ? null : shape.startedAt + variant.gapAtS * 1000
  const gapEnd = gapStart === null ? null : gapStart + 120_000
  if (gapStart !== null && gapEnd !== null) gaps.push({ from: gapStart, to: gapEnd })

  let speed = 0
  let target = 0
  let hold = 6
  let lat = 52.2297
  let lon = 21.0122
  let heading = random() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const t = shape.startedAt + i * STEP_S * 1000
    hold -= 1
    if (hold <= 0) {
      const r = random()
      if (r < 0.22) {
        target = 0
        hold = 5 + Math.floor(random() * 9)
      } else if (r < 0.88) {
        target = 25 + random() * 40
        hold = 8 + Math.floor(random() * 20)
      } else {
        target = 80 + random() * 25
        hold = 25 + Math.floor(random() * 30)
      }
    }
    const prev = speed
    const hard = random() < 0.012
    const maxUp = hard ? 28 : 9
    const maxDown = hard ? 30 : 11
    speed = clamp(speed + clamp(target - speed, -maxDown, maxUp) + (random() - 0.5) * 2, 0, 120)
    if (target === 0 && speed < 4) speed = 0
    const accel = (speed - prev) / STEP_S

    const inGap = gapStart !== null && gapEnd !== null && t >= gapStart && t < gapEnd
    const dist = ((speed / 3.6) * STEP_S) / 1000
    heading += speed < 3 ? (random() - 0.5) * 2.4 : random() < 0.06 ? (random() - 0.5) * 1.6 : (random() - 0.5) * 0.06
    lat += (Math.cos(heading) * dist * 1000) / 111_320
    lon += (Math.sin(heading) * dist * 1000) / (111_320 * Math.cos((lat * Math.PI) / 180))
    if (inGap) continue

    const gear = GEAR_THRESHOLDS.filter((g) => speed > g).length
    const rpm = speed < 1 ? 780 + random() * 60 : Math.max(850, speed * GEAR_RATIO[gear]! + (random() - 0.5) * 80)
    const load = clamp(0.18 + speed * 0.008 + accel * 0.1, 0.12, 0.95)
    const lph = 0.55 + (rpm / 1000) * 1.6 * load * 1.3
    const secs = i * STEP_S
    const coolant = 34 + 57 * (1 - Math.exp(-secs / 480)) + (random() - 0.5) * 0.8
    const crank = i === 1 ? 10.4 : i === 0 ? 12.45 : null
    const voltage = crank ?? 14.05 + (random() - 0.5) * 0.25

    ts.push(t)
    cols.speed_kmh!.push(round(speed, 0))
    cols.rpm!.push(round(rpm, -1))
    cols.coolant_c!.push(round(coolant, 0))
    cols.fuel_rate_lph!.push(variant.fuel ? round(lph, 1) : null)
    cols.voltage_v!.push(round(voltage, 1))
    cols.lat!.push(round(lat, 6))
    cols.lon!.push(round(lon, 6))
  }
  return { tripId: shape.tripId, ts, columns: cols, gaps }
}

const BANDS = [
  [0, 20],
  [20, 40],
  [40, 60],
  [60, 90],
  [90, 130]
] as const

export const buildTripFixture = (shape: TripShape): { insight: TripInsight; series: TripSeries } => {
  const series = buildSeries(shape)
  const variant = variantOf(shape.tripId)
  const speed = series.columns.speed_kmh!
  const rpm = series.columns.rpm!
  const lph = series.columns.fuel_rate_lph!
  const coolant = series.columns.coolant_c!
  const volt = series.columns.voltage_v!
  const lat = series.columns.lat!
  const lon = series.columns.lon!

  let km = 0
  let moving = 0
  let idle = 0
  let fuel = 0
  let idleFuel = 0
  let maxSpeed = 0
  let rpmSum = 0
  let hardAcc = 0
  let hardBrake = 0
  let warmup: number | null = null
  const bandSeconds = BANDS.map(() => 0)
  const bandFuel = BANDS.map(() => 0)
  const bandKm = BANDS.map(() => 0)
  series.ts.forEach((t, i) => {
    const v = speed[i] ?? 0
    km += (v / 3600) * STEP_S
    maxSpeed = Math.max(maxSpeed, v)
    rpmSum += rpm[i] ?? 0
    const f = ((lph[i] ?? 0) * STEP_S) / 3600
    fuel += f
    if (v > 2) moving += STEP_S
    else {
      idle += STEP_S
      idleFuel += f
    }
    const b = BANDS.findIndex(([lo, hi]) => v >= lo && v < hi)
    if (b >= 0) {
      bandSeconds[b]! += STEP_S
      bandFuel[b]! += f
      bandKm[b]! += (v / 3600) * STEP_S
    }
    if (i > 0 && t - series.ts[i - 1]! <= STEP_S * 1000 + 1) {
      const d = v - (speed[i - 1] ?? 0)
      if (d >= 25) hardAcc += 1
      if (d <= -25) hardBrake += 1
    }
    if (warmup === null && (coolant[i] ?? 0) >= 75) warmup = Math.round((t - shape.startedAt) / 1000)
  })
  const startIdx = lat.findIndex((v) => v !== null)
  const endIdx = lat.length - 1 - [...lat].reverse().findIndex((v) => v !== null)
  const fuelL = variant.fuel ? round(fuel, 2) : null
  const per100 = variant.fuel && km > 0.5 ? round((fuel / km) * 100, 1) : null
  const avgSpeed = series.ts.length > 0 ? round(km / ((moving + idle) / 3600), 0) : null
  const usualPer100 = 8.1
  const usualSpeed = 31
  const insight: TripInsight = {
    tripId: shape.tripId,
    startedAt: shape.startedAt,
    endedAt: shape.startedAt + shape.durationS * 1000,
    complete: series.gaps.length === 0,
    points: series.ts.length,
    durationS: shape.durationS,
    movingS: moving,
    idleS: idle,
    distanceKm: round(km, 1),
    avgSpeedKmh: avgSpeed,
    avgMovingSpeedKmh: moving > 0 ? round(km / (moving / 3600), 0) : null,
    maxSpeedKmh: maxSpeed,
    fuelL,
    fuelPer100Km: per100,
    fuelIsEstimate: variant.estimate,
    idleFuelL: variant.fuel ? round(idleFuel, 2) : null,
    maxRpm: Math.max(...rpm.map((v) => v ?? 0)),
    avgRpm: round(rpmSum / Math.max(1, series.ts.length), -1),
    maxCoolantC: Math.max(...coolant.map((v) => v ?? 0)),
    warmupS: warmup,
    minVoltageV: Math.min(...volt.map((v) => v ?? 99)),
    restingVoltageV: volt[0] ?? null,
    hardAccelerations: hardAcc,
    hardBrakings: hardBrake,
    speedBands: BANDS.map(([from, to], i) => ({
      fromKmh: from,
      toKmh: to,
      seconds: bandSeconds[i]!,
      fuelPer100Km: variant.fuel && bandKm[i]! > 0.3 ? round((bandFuel[i]! / bandKm[i]!) * 100, 1) : null
    })).filter((b) => b.seconds > 0),
    route: {
      startLat: lat[startIdx] ?? null,
      startLon: lon[startIdx] ?? null,
      endLat: lat[endIdx] ?? null,
      endLon: lon[endIdx] ?? null
    },
    comparedToUsual: {
      fuelPer100KmDeltaPct: per100 === null ? null : round(((per100 - usualPer100) / usualPer100) * 100, 0),
      avgSpeedDeltaPct: avgSpeed === null ? null : round(((avgSpeed - usualSpeed) / usualSpeed) * 100, 0)
    }
  }
  return { insight, series }
}

const tx = (lang: Lang, ru: string, en: string) => (lang === "ru" ? ru : en)

export const dtcExplanations = (lang: Lang, now: number): DtcExplanation[] => [
  {
    code: "P0420",
    kind: "stored",
    title: tx(lang, "Катализатор работает хуже нормы", "Catalytic converter efficiency is below normal"),
    meaning: tx(
      lang,
      "Блок управления видит, что нейтрализатор выхлопных газов очищает выхлоп хуже, чем должен. Это не поломка, из-за которой нельзя ехать, но выхлоп становится грязнее.",
      "The engine computer sees that the exhaust cleaner is doing a worse job than it should. It is not a breakdown that stops the car, but the exhaust gets dirtier."
    ),
    severity: "soon",
    canDrive: tx(lang, "Ехать можно. Покажите машину в сервисе в ближайшие 2 недели.", "You can drive. Have it checked within 2 weeks."),
    commonCauses: [
      tx(lang, "Износ катализатора", "Worn catalytic converter"),
      tx(lang, "Неисправный кислородный датчик после катализатора", "Faulty oxygen sensor after the converter"),
      tx(lang, "Подсос воздуха в выпускной системе", "Exhaust leak before the sensor")
    ],
    whatToDo: tx(
      lang,
      "Запишитесь в сервис на диагностику. Сначала стоит проверить датчик: он дешевле катализатора.",
      "Book a diagnostic visit. The sensor is worth checking first: it costs far less than the converter."
    ),
    firstSeenAt: now - 9 * DAY,
    lastSeenAt: now - 3 * 3_600_000,
    source: "catalog"
  },
  {
    code: "P0171",
    kind: "pending",
    title: tx(lang, "Смесь слишком бедная", "Fuel mix is too lean"),
    meaning: tx(
      lang,
      "В двигатель попадает больше воздуха, чем нужно для топлива. Пока ошибка предварительная: она могла появиться один раз и пропасть.",
      "The engine gets more air than the fuel needs. The code is still pending: it may have appeared once and go away."
    ),
    severity: "watch",
    canDrive: tx(lang, "Ехать можно. Понаблюдайте несколько дней.", "You can drive. Keep an eye on it for a few days."),
    commonCauses: [
      tx(lang, "Подсос воздуха во впускном тракте", "Air leak in the intake"),
      tx(lang, "Загрязнённый датчик расхода воздуха", "Dirty airflow sensor"),
      tx(lang, "Слабый топливный насос", "Weak fuel pump")
    ],
    whatToDo: tx(
      lang,
      "Если ошибка вернётся и загорится лампа, покажите машину мастеру. Пока ничего делать не нужно.",
      "If it returns and the warning lamp lights up, show the car to a mechanic. Nothing to do for now."
    ),
    firstSeenAt: now - 2 * DAY,
    lastSeenAt: now - 27 * 3_600_000,
    source: "catalog"
  }
]

const period = (label: string, trips: number, km: number, h: number, per100: number | null, idle: number): PeriodStats => ({
  period: label,
  trips,
  distanceKm: round(km, 1),
  durationS: Math.round(h * 3600),
  fuelL: per100 === null ? null : round((km * per100) / 100, 1),
  fuelPer100Km: per100,
  avgSpeedKmh: round(km / h, 0),
  idleShare: idle
})

const isoWeek = (ms: number): string => {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1)
  const w = Math.ceil(((t.getTime() - y0) / DAY + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`
}

const monthKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export const buildOverviewFixture = (scenario: InsightScenario, lang: Lang, now: number): CarOverview => {
  const issues = scenario === "issues"
  const rand = rng(7)
  const weekKm = [96, 142, 118, 160, 104, 131, 150, 122, 138, 74]
  const weekPer100 = [7.6, 7.9, 8.0, 7.8, 8.1, 7.9, 8.2, 8.0, 8.4, 9.2]
  const byWeek = weekKm.map((km, i) => {
    const at = now - (weekKm.length - 1 - i) * 7 * DAY
    const h = km / (28 + rand() * 6)
    return period(isoWeek(at), 4 + Math.floor(rand() * 5), km, h, issues || i < 9 ? weekPer100[i]! : 8.0, round(0.16 + rand() * 0.08, 2))
  })
  const monthKm = [410, 520, 466, 540, 498, 330]
  const byMonth = monthKm.map((km, i) => {
    const at = new Date(now)
    at.setUTCMonth(at.getUTCMonth() - (monthKm.length - 1 - i), 15)
    return period(monthKey(at.getTime()), 14 + i, km, km / 30, 7.9 + (i % 3) * 0.15, round(0.17 + (i % 2) * 0.03, 2))
  })
  const totals = period("all", 71, 2764, 2764 / 30, 8.0, 0.19)

  const trend = Array.from({ length: 14 }, (_, i) => {
    const at = now - (13 - i) * 3 * DAY
    const drift = issues ? (i - 13) * 0.012 : 0
    return {
      at,
      restingV: round((issues ? 12.5 : 12.72) + drift + (rand() - 0.5) * 0.12, 2),
      crankMinV: i % 5 === 3 ? null : round((issues ? 10.2 : 10.6) + drift * 2.4 + (rand() - 0.5) * 0.3, 1)
    }
  })

  const alerts: Alert[] = issues
    ? [
        {
          id: "al-1",
          kind: "check_engine",
          severity: "soon",
          title: tx(lang, "Горит лампа «Проверьте двигатель»", "The check engine lamp is on"),
          details: tx(lang, "Найдена постоянная ошибка P0420 и предварительная P0171.", "A stored code P0420 and a pending code P0171 were found."),
          whatToDo: tx(lang, "Можно ехать. Запишитесь в сервис в течение 2 недель.", "You can drive. Book a service visit within 2 weeks."),
          createdAt: now - 9 * DAY,
          resolvedAt: null,
          tripId: null,
          evidence: { codes: 2 }
        },
        {
          id: "al-2",
          kind: "battery_weak",
          severity: "watch",
          title: tx(lang, "Аккумулятор понемногу слабеет", "The battery is slowly weakening"),
          details: tx(
            lang,
            "Напряжение при запуске двигателя стало ниже, чем 6 недель назад: 9,9 В вместо 10,4 В.",
            "Voltage while starting the engine is lower than 6 weeks ago: 9.9 V instead of 10.4 V."
          ),
          whatToDo: tx(
            lang,
            "Пока заводится уверенно. Проверьте аккумулятор перед зимой: это бесплатно в большинстве сервисов.",
            "It still starts fine. Have the battery tested before winter: most workshops do this for free."
          ),
          createdAt: now - 4 * DAY,
          resolvedAt: null,
          tripId: null,
          evidence: { crankMinV: 9.9, restingV: 12.3 }
        },
        {
          id: "al-3",
          kind: "fuel_consumption_up",
          severity: "info",
          title: tx(lang, "Расход топлива вырос", "Fuel use went up"),
          details: tx(lang, "На прошлой неделе 9,2 л на 100 км, обычно около 8,0 л.", "Last week 9.2 L per 100 km, usually about 8.0 L."),
          whatToDo: tx(
            lang,
            "Если неделя была городской, это нормально. Если расход держится, проверьте давление в шинах.",
            "If the week was mostly city driving this is normal. If it stays high, check the tyre pressure."
          ),
          createdAt: now - 1 * DAY,
          resolvedAt: null,
          tripId: null,
          evidence: { per100: 9.2, usual: 8 }
        },
        {
          id: "al-0",
          kind: "check_engine",
          severity: "watch",
          title: tx(lang, "Была ошибка P0301: пропуски зажигания в 1 цилиндре", "Code P0301 appeared: misfire in cylinder 1"),
          details: tx(lang, "Ошибка исчезла сама после замены свечей.", "The code went away after the spark plugs were replaced."),
          whatToDo: tx(lang, "Ничего делать не нужно.", "Nothing to do."),
          createdAt: now - 41 * DAY,
          resolvedAt: now - 33 * DAY,
          tripId: null,
          evidence: { codes: 1 }
        }
      ]
    : []

  return {
    generatedAt: now,
    vin: "WVWZZZ1KZ6W000000",
    lastTripAt: now - 3 * 3_600_000 + 41 * 60_000,
    totals,
    byMonth,
    byWeek,
    battery: {
      status: issues ? "watch" : "good",
      lastRestingV: trend[13]!.restingV,
      lastCrankMinV: [...trend].reverse().find((p) => p.crankMinV !== null)?.crankMinV ?? null,
      trend
    },
    engine: {
      milOn: issues,
      activeCodes: issues ? dtcExplanations(lang, now) : [],
      lastScanAt: now - 3 * 3_600_000,
      maxCoolantC30d: 96
    },
    alerts
  }
}
