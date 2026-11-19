import type { Severity } from "@bot/car-format/insights"
import type { GroupId } from "./groups.ts"

export type CatalogEntry = {
  readonly code: string
  readonly group: GroupId
  readonly en: string
  readonly ru: string
  readonly severity?: Severity
}

const e = (code: string, group: GroupId, en: string, ru: string, severity?: Severity): CatalogEntry =>
  severity === undefined ? { code, group, en, ru } : { code, group, en, ru, severity }

const hex = (n: number, prefix = "P") => `${prefix}${n.toString(16).toUpperCase().padStart(4, "0")}`

const sensorVariants = (
  base: number,
  group: GroupId,
  enName: string,
  ruName: string,
  variants: ReadonlyArray<readonly [number, string, string]>
): ReadonlyArray<CatalogEntry> =>
  variants.map(([offset, en, ru]) => e(hex(base + offset), group, `${enName} ${en}`, `${ruName}: ${ru}`))

const CIRCUIT: ReadonlyArray<readonly [number, string, string]> = [
  [0, "circuit", "неисправность цепи"],
  [1, "range/performance", "сигнал вне диапазона"],
  [2, "circuit low", "низкий уровень сигнала"],
  [3, "circuit high", "высокий уровень сигнала"],
  [4, "circuit intermittent", "нестабильный сигнал"]
]

const O2_TESTS: ReadonlyArray<readonly [number, string, string]> = [
  [0, "circuit", "неисправность цепи"],
  [1, "circuit low voltage", "низкое напряжение"],
  [2, "circuit high voltage", "высокое напряжение"],
  [3, "circuit slow response", "медленный отклик"],
  [4, "no activity detected", "нет активности"]
]

const O2_SENSORS = [
  [0x130, "Bank 1 Sensor 1", "ряд 1, датчик 1 (до катализатора)"],
  [0x136, "Bank 1 Sensor 2", "ряд 1, датчик 2 (после катализатора)"],
  [0x150, "Bank 2 Sensor 1", "ряд 2, датчик 1 (до катализатора)"],
  [0x156, "Bank 2 Sensor 2", "ряд 2, датчик 2 (после катализатора)"]
] as const

const o2Entries = O2_SENSORS.flatMap(([base, en, ru]) => [
  ...sensorVariants(base, "o2", `O2 sensor ${en}`, `Кислородный датчик, ${ru}`, O2_TESTS),
  e(hex(base + 5), "o2heater", `O2 sensor heater circuit ${en}`, `Нагреватель кислородного датчика, ${ru}: неисправность цепи`)
])

const O2_HEATER_CONTROLS = [
  [0x30, "Bank 1 Sensor 1", "ряд 1, датчик 1"],
  [0x36, "Bank 1 Sensor 2", "ряд 1, датчик 2"],
  [0x50, "Bank 2 Sensor 1", "ряд 2, датчик 1"],
  [0x56, "Bank 2 Sensor 2", "ряд 2, датчик 2"]
] as const

const o2HeaterEntries = O2_HEATER_CONTROLS.flatMap(([base, en, ru]) => [
  e(hex(base), "o2heater", `O2 sensor heater control circuit ${en}`, `Управление нагревателем кислородного датчика, ${ru}: неисправность цепи`),
  e(hex(base + 1), "o2heater", `O2 sensor heater control circuit low ${en}`, `Управление нагревателем кислородного датчика, ${ru}: низкий уровень`),
  e(hex(base + 2), "o2heater", `O2 sensor heater control circuit high ${en}`, `Управление нагревателем кислородного датчика, ${ru}: высокий уровень`)
])

const CYLINDER_RU = ["1", "2", "3", "4", "5", "6", "7", "8"]

const perCylinder = (
  count: number,
  make: (n: number) => ReadonlyArray<CatalogEntry>
): ReadonlyArray<CatalogEntry> => Array.from({ length: count }, (_, i) => make(i + 1)).flat()

const misfireEntries = perCylinder(8, (n) => [
  e(hex(0x300 + n), "misfire", `Cylinder ${n} misfire detected`, `Пропуски зажигания в цилиндре ${CYLINDER_RU[n - 1]}`)
])

const injectorEntries = perCylinder(8, (n) => [
  e(hex(0x200 + n), "injector", `Injector circuit/open cylinder ${n}`, `Форсунка цилиндра ${n}: обрыв или неисправность цепи`)
])

const INJECTOR_LOW_HIGH = [
  [0x261, 1],
  [0x264, 2],
  [0x267, 3],
  [0x270, 4],
  [0x273, 5],
  [0x276, 6],
  [0x279, 7],
  [0x282, 8]
] as const

const injectorLowHighEntries = INJECTOR_LOW_HIGH.flatMap(([base, n]) => [
  e(hex(base), "injector", `Cylinder ${n} injector circuit low`, `Форсунка цилиндра ${n}: низкий уровень в цепи`),
  e(hex(base + 1), "injector", `Cylinder ${n} injector circuit high`, `Форсунка цилиндра ${n}: высокий уровень в цепи`)
])

const COIL_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"]

const coilEntries = [
  e("P0350", "coil", "Ignition coil primary/secondary circuit", "Катушка зажигания: неисправность первичной или вторичной цепи"),
  ...COIL_LETTERS.map((letter, i) =>
    e(hex(0x351 + i), "coil", `Ignition coil ${letter} primary/secondary circuit`, `Катушка зажигания ${letter}: неисправность первичной или вторичной цепи`)
  )
]

const vvtEntries = [
  e("P0010", "vvt", "Intake camshaft position actuator circuit (Bank 1)", "Привод фаз впускного распредвала, ряд 1: неисправность цепи"),
  e("P0011", "vvt", "Intake camshaft timing over-advanced or system performance (Bank 1)", "Фазы впускного распредвала, ряд 1: чрезмерное опережение"),
  e("P0012", "vvt", "Intake camshaft timing over-retarded (Bank 1)", "Фазы впускного распредвала, ряд 1: чрезмерное запаздывание"),
  e("P0013", "vvt", "Exhaust camshaft position actuator circuit (Bank 1)", "Привод фаз выпускного распредвала, ряд 1: неисправность цепи"),
  e("P0014", "vvt", "Exhaust camshaft timing over-advanced or system performance (Bank 1)", "Фазы выпускного распредвала, ряд 1: чрезмерное опережение"),
  e("P0015", "vvt", "Exhaust camshaft timing over-retarded (Bank 1)", "Фазы выпускного распредвала, ряд 1: чрезмерное запаздывание"),
  e("P0016", "vvt", "Crankshaft/camshaft position correlation (Bank 1 Sensor A)", "Рассогласование коленвала и распредвала, ряд 1, датчик A"),
  e("P0017", "vvt", "Crankshaft/camshaft position correlation (Bank 1 Sensor B)", "Рассогласование коленвала и распредвала, ряд 1, датчик B"),
  e("P0018", "vvt", "Crankshaft/camshaft position correlation (Bank 2 Sensor A)", "Рассогласование коленвала и распредвала, ряд 2, датчик A"),
  e("P0019", "vvt", "Crankshaft/camshaft position correlation (Bank 2 Sensor B)", "Рассогласование коленвала и распредвала, ряд 2, датчик B"),
  e("P0020", "vvt", "Intake camshaft position actuator circuit (Bank 2)", "Привод фаз впускного распредвала, ряд 2: неисправность цепи"),
  e("P0021", "vvt", "Intake camshaft timing over-advanced or system performance (Bank 2)", "Фазы впускного распредвала, ряд 2: чрезмерное опережение"),
  e("P0022", "vvt", "Intake camshaft timing over-retarded (Bank 2)", "Фазы впускного распредвала, ряд 2: чрезмерное запаздывание"),
  e("P0023", "vvt", "Exhaust camshaft position actuator circuit (Bank 2)", "Привод фаз выпускного распредвала, ряд 2: неисправность цепи"),
  e("P0024", "vvt", "Exhaust camshaft timing over-advanced or system performance (Bank 2)", "Фазы выпускного распредвала, ряд 2: чрезмерное опережение"),
  e("P0025", "vvt", "Exhaust camshaft timing over-retarded (Bank 2)", "Фазы выпускного распредвала, ряд 2: чрезмерное запаздывание")
]

const fuelEntries = [
  e("P0087", "fuelPressure", "Fuel rail/system pressure too low", "Давление в топливной рейке или системе слишком низкое"),
  e("P0088", "fuelPressure", "Fuel rail/system pressure too high", "Давление в топливной рейке или системе слишком высокое"),
  e("P0089", "fuelPressure", "Fuel pressure regulator 1 performance", "Регулятор давления топлива 1: неверная работа"),
  e("P0090", "fuelPressure", "Fuel pressure regulator 1 control circuit", "Регулятор давления топлива 1: неисправность цепи управления"),
  e("P0091", "fuelPressure", "Fuel pressure regulator 1 control circuit low", "Регулятор давления топлива 1: низкий уровень в цепи"),
  e("P0092", "fuelPressure", "Fuel pressure regulator 1 control circuit high", "Регулятор давления топлива 1: высокий уровень в цепи"),
  e("P0093", "fuelPressure", "Fuel system leak detected (large leak)", "Обнаружена утечка в топливной системе (большая)", "urgent"),
  ...sensorVariants(0x190, "fuelPressure", "Fuel rail pressure sensor", "Датчик давления в топливной рейке", CIRCUIT),
  e("P0230", "fuelPump", "Fuel pump primary circuit", "Топливный насос: неисправность первичной цепи"),
  e("P0231", "fuelPump", "Fuel pump secondary circuit low", "Топливный насос: низкий уровень во вторичной цепи"),
  e("P0232", "fuelPump", "Fuel pump secondary circuit high", "Топливный насос: высокий уровень во вторичной цепи"),
  e("P0627", "fuelPump", "Fuel pump A control circuit open", "Управление топливным насосом A: обрыв цепи"),
  e("P0628", "fuelPump", "Fuel pump A control circuit low", "Управление топливным насосом A: низкий уровень в цепи"),
  e("P0629", "fuelPump", "Fuel pump A control circuit high", "Управление топливным насосом A: высокий уровень в цепи"),
  e("P0200", "injector", "Injector circuit", "Форсунка: неисправность цепи"),
  ...sensorVariants(0x460, "fuelLevel", "Fuel level sensor", "Датчик уровня топлива", CIRCUIT)
]

const trimEntries = [
  e("P0170", "trimOther", "Fuel trim malfunction (Bank 1)", "Неисправность коррекции топливоподачи, ряд 1"),
  e("P0171", "trimLean", "System too lean (Bank 1)", "Слишком бедная смесь, ряд 1"),
  e("P0172", "trimRich", "System too rich (Bank 1)", "Слишком богатая смесь, ряд 1"),
  e("P0173", "trimOther", "Fuel trim malfunction (Bank 2)", "Неисправность коррекции топливоподачи, ряд 2"),
  e("P0174", "trimLean", "System too lean (Bank 2)", "Слишком бедная смесь, ряд 2"),
  e("P0175", "trimRich", "System too rich (Bank 2)", "Слишком богатая смесь, ряд 2"),
  e("P2096", "trimOther", "Post catalyst fuel trim system too lean (Bank 1)", "Смесь после катализатора слишком бедная, ряд 1"),
  e("P2097", "trimOther", "Post catalyst fuel trim system too rich (Bank 1)", "Смесь после катализатора слишком богатая, ряд 1"),
  e("P2098", "trimOther", "Post catalyst fuel trim system too lean (Bank 2)", "Смесь после катализатора слишком бедная, ряд 2"),
  e("P2099", "trimOther", "Post catalyst fuel trim system too rich (Bank 2)", "Смесь после катализатора слишком богатая, ряд 2"),
  e("P2187", "trimLean", "System too lean at idle (Bank 1)", "Слишком бедная смесь на холостом ходу, ряд 1"),
  e("P2188", "trimRich", "System too rich at idle (Bank 1)", "Слишком богатая смесь на холостом ходу, ряд 1"),
  e("P2189", "trimLean", "System too lean at idle (Bank 2)", "Слишком бедная смесь на холостом ходу, ряд 2"),
  e("P2190", "trimRich", "System too rich at idle (Bank 2)", "Слишком богатая смесь на холостом ходу, ряд 2"),
  e("P2195", "o2", "O2 sensor signal stuck lean (Bank 1 Sensor 1)", "Сигнал кислородного датчика застрял на бедной смеси, ряд 1, датчик 1"),
  e("P2196", "o2", "O2 sensor signal stuck rich (Bank 1 Sensor 1)", "Сигнал кислородного датчика застрял на богатой смеси, ряд 1, датчик 1"),
  e("P2197", "o2", "O2 sensor signal stuck lean (Bank 2 Sensor 1)", "Сигнал кислородного датчика застрял на бедной смеси, ряд 2, датчик 1"),
  e("P2198", "o2", "O2 sensor signal stuck rich (Bank 2 Sensor 1)", "Сигнал кислородного датчика застрял на богатой смеси, ряд 2, датчик 1"),
  e("P2270", "o2", "O2 sensor signal stuck lean (Bank 1 Sensor 2)", "Сигнал кислородного датчика застрял на бедной смеси, ряд 1, датчик 2"),
  e("P2271", "o2", "O2 sensor signal stuck rich (Bank 1 Sensor 2)", "Сигнал кислородного датчика застрял на богатой смеси, ряд 1, датчик 2"),
  e("P2272", "o2", "O2 sensor signal stuck lean (Bank 2 Sensor 2)", "Сигнал кислородного датчика застрял на бедной смеси, ряд 2, датчик 2"),
  e("P2273", "o2", "O2 sensor signal stuck rich (Bank 2 Sensor 2)", "Сигнал кислородного датчика застрял на богатой смеси, ряд 2, датчик 2")
]

const airEntries = [
  ...sensorVariants(0x100, "maf", "Mass air flow sensor", "Датчик массового расхода воздуха", CIRCUIT),
  ...sensorVariants(0x105, "map", "Manifold absolute pressure sensor", "Датчик абсолютного давления во впуске", CIRCUIT),
  ...sensorVariants(0x110, "iat", "Intake air temperature sensor", "Датчик температуры воздуха на впуске", CIRCUIT),
  ...sensorVariants(0x115, "ect", "Engine coolant temperature sensor", "Датчик температуры охлаждающей жидкости", CIRCUIT),
  e("P0125", "warmup", "Insufficient coolant temperature for closed loop fuel control", "Недостаточная температура охлаждающей жидкости для регулирования по лямбда-зонду"),
  e("P0126", "warmup", "Insufficient coolant temperature for stable operation", "Недостаточная температура охлаждающей жидкости для стабильной работы"),
  e("P0128", "warmup", "Coolant thermostat (coolant temperature below thermostat regulating temperature)", "Термостат: температура охлаждающей жидкости ниже рабочей"),
  ...sensorVariants(0x196, "oilTemp", "Engine oil temperature sensor", "Датчик температуры масла", [
    [0, "range/performance", "сигнал вне диапазона"],
    [1, "circuit low", "низкий уровень сигнала"],
    [2, "circuit high", "высокий уровень сигнала"]
  ]),
  ...sensorVariants(0x120, "throttle", "Throttle/pedal position sensor A", "Датчик положения дросселя или педали A", CIRCUIT),
  ...sensorVariants(0x220, "throttle", "Throttle/pedal position sensor B", "Датчик положения дросселя или педали B", [
    [0, "circuit", "неисправность цепи"],
    [1, "range/performance", "сигнал вне диапазона"],
    [2, "circuit low", "низкий уровень сигнала"],
    [3, "circuit high", "высокий уровень сигнала"]
  ]),
  e("P2101", "throttle", "Throttle actuator control motor circuit range/performance", "Электропривод дроссельной заслонки: сигнал вне диапазона"),
  e("P2102", "throttle", "Throttle actuator control motor circuit low", "Электропривод дроссельной заслонки: низкий уровень в цепи"),
  e("P2103", "throttle", "Throttle actuator control motor circuit high", "Электропривод дроссельной заслонки: высокий уровень в цепи"),
  e("P2104", "throttle", "Throttle actuator control system forced idle", "Система привода дросселя: принудительный холостой ход"),
  e("P2105", "throttle", "Throttle actuator control system forced engine shutdown", "Система привода дросселя: принудительная остановка двигателя"),
  e("P2106", "throttle", "Throttle actuator control system forced limited power", "Система привода дросселя: принудительное ограничение мощности"),
  e("P2110", "throttle", "Throttle actuator control system forced limited RPM", "Система привода дросселя: принудительное ограничение оборотов"),
  e("P2120", "throttle", "Throttle/pedal position sensor/switch D circuit", "Датчик положения педали D: неисправность цепи"),
  e("P2121", "throttle", "Throttle/pedal position sensor/switch D range/performance", "Датчик положения педали D: сигнал вне диапазона"),
  e("P2122", "throttle", "Throttle/pedal position sensor/switch D circuit low", "Датчик положения педали D: низкий уровень сигнала"),
  e("P2123", "throttle", "Throttle/pedal position sensor/switch D circuit high", "Датчик положения педали D: высокий уровень сигнала"),
  e("P2127", "throttle", "Throttle/pedal position sensor/switch E circuit low", "Датчик положения педали E: низкий уровень сигнала"),
  e("P2128", "throttle", "Throttle/pedal position sensor/switch E circuit high", "Датчик положения педали E: высокий уровень сигнала"),
  e("P2135", "throttle", "Throttle/pedal position sensor/switch A/B voltage correlation", "Датчики положения дросселя A и B: напряжения не согласуются"),
  e("P2138", "throttle", "Throttle/pedal position sensor/switch D/E voltage correlation", "Датчики положения педали D и E: напряжения не согласуются"),
  e("P2279", "intake", "Intake air system leak", "Негерметичность системы впуска воздуха"),
  e("P2004", "intake", "Intake manifold runner control stuck open (Bank 1)", "Управление заслонками впускного коллектора застряло в открытом положении, ряд 1"),
  e("P2006", "intake", "Intake manifold runner control stuck closed (Bank 1)", "Управление заслонками впускного коллектора застряло в закрытом положении, ряд 1"),
  e("P0217", "overheat", "Engine overtemperature condition", "Перегрев двигателя"),
  e("P0218", "overheat", "Transmission over temperature condition", "Перегрев коробки передач"),
  e("P2181", "overheat", "Cooling system performance", "Неэффективная работа системы охлаждения"),
  e("P0219", "overspeed", "Engine overspeed condition", "Превышение допустимых оборотов двигателя")
]

const ignitionEntries = [
  e("P0300", "misfire", "Random/multiple cylinder misfire detected", "Обнаружены пропуски зажигания в нескольких цилиндрах"),
  ...misfireEntries,
  e("P0325", "knock", "Knock sensor 1 circuit (Bank 1)", "Датчик детонации 1, ряд 1: неисправность цепи"),
  e("P0326", "knock", "Knock sensor 1 circuit range/performance (Bank 1)", "Датчик детонации 1, ряд 1: сигнал вне диапазона"),
  e("P0327", "knock", "Knock sensor 1 circuit low (Bank 1)", "Датчик детонации 1, ряд 1: низкий уровень сигнала"),
  e("P0328", "knock", "Knock sensor 1 circuit high (Bank 1)", "Датчик детонации 1, ряд 1: высокий уровень сигнала"),
  e("P0330", "knock", "Knock sensor 2 circuit (Bank 2)", "Датчик детонации 2, ряд 2: неисправность цепи"),
  e("P0331", "knock", "Knock sensor 2 circuit range/performance (Bank 2)", "Датчик детонации 2, ряд 2: сигнал вне диапазона"),
  e("P0332", "knock", "Knock sensor 2 circuit low (Bank 2)", "Датчик детонации 2, ряд 2: низкий уровень сигнала"),
  e("P0333", "knock", "Knock sensor 2 circuit high (Bank 2)", "Датчик детонации 2, ряд 2: высокий уровень сигнала"),
  ...sensorVariants(0x335, "crank", "Crankshaft position sensor A", "Датчик положения коленвала A", CIRCUIT),
  ...sensorVariants(0x340, "cam", "Camshaft position sensor A (Bank 1)", "Датчик положения распредвала A, ряд 1", CIRCUIT),
  ...sensorVariants(0x345, "cam", "Camshaft position sensor A (Bank 2)", "Датчик положения распредвала A, ряд 2", CIRCUIT),
  ...sensorVariants(0x365, "cam", "Camshaft position sensor B (Bank 1)", "Датчик положения распредвала B, ряд 1", CIRCUIT),
  ...coilEntries,
  e("P0380", "glow", "Glow plug/heater circuit A", "Свечи накала, цепь A: неисправность"),
  e("P0381", "glow", "Glow plug/heater indicator circuit", "Индикатор свечей накала: неисправность цепи"),
  e("P0382", "glow", "Glow plug/heater circuit B", "Свечи накала, цепь B: неисправность")
]

const emissionEntries = [
  e("P0400", "egr", "Exhaust gas recirculation flow", "Рециркуляция отработавших газов: неисправность потока"),
  e("P0401", "egr", "Exhaust gas recirculation flow insufficient", "Рециркуляция отработавших газов: недостаточный поток"),
  e("P0402", "egr", "Exhaust gas recirculation flow excessive", "Рециркуляция отработавших газов: чрезмерный поток"),
  e("P0403", "egr", "Exhaust gas recirculation control circuit", "Рециркуляция отработавших газов: неисправность цепи управления"),
  e("P0404", "egr", "Exhaust gas recirculation control circuit range/performance", "Рециркуляция отработавших газов: сигнал вне диапазона"),
  e("P0405", "egr", "Exhaust gas recirculation sensor A circuit low", "Датчик рециркуляции A: низкий уровень сигнала"),
  e("P0406", "egr", "Exhaust gas recirculation sensor A circuit high", "Датчик рециркуляции A: высокий уровень сигнала"),
  e("P0410", "airPump", "Secondary air injection system", "Система вторичной подачи воздуха: неисправность"),
  e("P0411", "airPump", "Secondary air injection system incorrect flow detected", "Система вторичной подачи воздуха: неверный поток"),
  e("P0412", "airPump", "Secondary air injection system switching valve A circuit", "Клапан переключения вторичного воздуха A: неисправность цепи"),
  e("P0420", "catalyst", "Catalyst system efficiency below threshold (Bank 1)", "Эффективность катализатора ниже порога, ряд 1"),
  e("P0421", "catalyst", "Warm up catalyst efficiency below threshold (Bank 1)", "Эффективность прогретого катализатора ниже порога, ряд 1"),
  e("P0422", "catalyst", "Main catalyst efficiency below threshold (Bank 1)", "Эффективность основного катализатора ниже порога, ряд 1"),
  e("P0430", "catalyst", "Catalyst system efficiency below threshold (Bank 2)", "Эффективность катализатора ниже порога, ряд 2"),
  e("P0431", "catalyst", "Warm up catalyst efficiency below threshold (Bank 2)", "Эффективность прогретого катализатора ниже порога, ряд 2"),
  e("P0432", "catalyst", "Main catalyst efficiency below threshold (Bank 2)", "Эффективность основного катализатора ниже порога, ряд 2"),
  e("P0440", "evapLeak", "Evaporative emission system", "Система улавливания паров топлива: неисправность"),
  e("P0441", "evapValve", "Evaporative emission system incorrect purge flow", "Система улавливания паров: неверный поток продувки"),
  e("P0442", "evapLeak", "Evaporative emission system leak detected (small leak)", "Система улавливания паров: обнаружена небольшая утечка"),
  e("P0443", "evapValve", "Evaporative emission system purge control valve circuit", "Клапан продувки адсорбера: неисправность цепи"),
  e("P0444", "evapValve", "Evaporative emission system purge control valve circuit open", "Клапан продувки адсорбера: обрыв цепи"),
  e("P0445", "evapValve", "Evaporative emission system purge control valve circuit shorted", "Клапан продувки адсорбера: короткое замыкание цепи"),
  e("P0446", "evapValve", "Evaporative emission system vent control circuit", "Клапан вентиляции системы паров: неисправность цепи"),
  e("P0447", "evapValve", "Evaporative emission system vent control circuit open", "Клапан вентиляции системы паров: обрыв цепи"),
  e("P0448", "evapValve", "Evaporative emission system vent control circuit shorted", "Клапан вентиляции системы паров: короткое замыкание цепи"),
  e("P0449", "evapValve", "Evaporative emission system vent valve/solenoid circuit", "Клапан или соленоид вентиляции системы паров: неисправность цепи"),
  ...sensorVariants(0x450, "evapValve", "Evaporative emission system pressure sensor", "Датчик давления системы улавливания паров", CIRCUIT),
  e("P0455", "evapLeak", "Evaporative emission system leak detected (large leak)", "Система улавливания паров: обнаружена большая утечка (часто не закрыта крышка бака)"),
  e("P0456", "evapLeak", "Evaporative emission system leak detected (very small leak)", "Система улавливания паров: обнаружена очень маленькая утечка"),
  e("P0457", "evapLeak", "Evaporative emission system leak detected (fuel cap loose/off)", "Система улавливания паров: утечка (крышка бака неплотно закрыта или отсутствует)"),
  e("P0458", "evapValve", "Evaporative emission system purge control valve circuit low", "Клапан продувки адсорбера: низкий уровень в цепи"),
  e("P0459", "evapValve", "Evaporative emission system purge control valve circuit high", "Клапан продувки адсорбера: высокий уровень в цепи"),
  e("P2002", "dpf", "Diesel particulate filter efficiency below threshold (Bank 1)", "Эффективность сажевого фильтра ниже порога, ряд 1"),
  e("P2003", "dpf", "Diesel particulate filter efficiency below threshold (Bank 2)", "Эффективность сажевого фильтра ниже порога, ряд 2"),
  e("P2452", "dpf", "Diesel particulate filter pressure sensor A circuit", "Датчик давления сажевого фильтра A: неисправность цепи"),
  e("P2453", "dpf", "Diesel particulate filter pressure sensor A range/performance", "Датчик давления сажевого фильтра A: сигнал вне диапазона"),
  e("P2454", "dpf", "Diesel particulate filter pressure sensor A circuit low", "Датчик давления сажевого фильтра A: низкий уровень сигнала"),
  e("P2455", "dpf", "Diesel particulate filter pressure sensor A circuit high", "Датчик давления сажевого фильтра A: высокий уровень сигнала"),
  e("P2458", "dpf", "Diesel particulate filter regeneration duration", "Слишком большая длительность регенерации сажевого фильтра"),
  e("P2463", "dpf", "Diesel particulate filter soot accumulation", "Избыточное накопление сажи в сажевом фильтре")
]

const boostEntries = [
  e("P0234", "turbo", "Turbocharger/supercharger overboost condition", "Избыточный наддув турбины или нагнетателя"),
  e("P0235", "turbo", "Turbocharger/supercharger boost sensor A circuit", "Датчик давления наддува A: неисправность цепи"),
  e("P0236", "turbo", "Turbocharger/supercharger boost sensor A range/performance", "Датчик давления наддува A: сигнал вне диапазона"),
  e("P0237", "turbo", "Turbocharger/supercharger boost sensor A circuit low", "Датчик давления наддува A: низкий уровень сигнала"),
  e("P0238", "turbo", "Turbocharger/supercharger boost sensor A circuit high", "Датчик давления наддува A: высокий уровень сигнала"),
  e("P0243", "turbo", "Turbocharger wastegate solenoid A", "Соленоид вестгейта A: неисправность"),
  e("P0245", "turbo", "Turbocharger wastegate solenoid A low", "Соленоид вестгейта A: низкий уровень в цепи"),
  e("P0246", "turbo", "Turbocharger wastegate solenoid A high", "Соленоид вестгейта A: высокий уровень в цепи"),
  e("P0299", "turbo", "Turbocharger/supercharger underboost condition", "Недостаточный наддув турбины или нагнетателя")
]

const controlEntries = [
  e("P0480", "fan", "Cooling fan 1 control circuit", "Вентилятор охлаждения 1: неисправность цепи управления"),
  e("P0481", "fan", "Cooling fan 2 control circuit", "Вентилятор охлаждения 2: неисправность цепи управления"),
  e("P0482", "fan", "Cooling fan 3 control circuit", "Вентилятор охлаждения 3: неисправность цепи управления"),
  e("P0483", "fan", "Cooling fan rationality check", "Вентилятор охлаждения: проверка достоверности не пройдена"),
  e("P0484", "fan", "Cooling fan circuit over current", "Вентилятор охлаждения: превышение тока в цепи"),
  e("P0485", "fan", "Cooling fan power/ground circuit", "Вентилятор охлаждения: неисправность цепи питания или массы"),
  e("P0500", "speed", "Vehicle speed sensor A", "Датчик скорости автомобиля A: неисправность"),
  e("P0501", "speed", "Vehicle speed sensor A range/performance", "Датчик скорости автомобиля A: сигнал вне диапазона"),
  e("P0502", "speed", "Vehicle speed sensor A circuit low", "Датчик скорости автомобиля A: низкий уровень сигнала"),
  e("P0503", "speed", "Vehicle speed sensor A intermittent/erratic/high", "Датчик скорости автомобиля A: нестабильный или завышенный сигнал"),
  e("P0505", "idle", "Idle control system", "Система регулирования холостого хода: неисправность"),
  e("P0506", "idle", "Idle control system RPM lower than expected", "Обороты холостого хода ниже ожидаемых"),
  e("P0507", "idle", "Idle control system RPM higher than expected", "Обороты холостого хода выше ожидаемых"),
  e("P0508", "idle", "Idle control system circuit low", "Регулятор холостого хода: низкий уровень в цепи"),
  e("P0509", "idle", "Idle control system circuit high", "Регулятор холостого хода: высокий уровень в цепи"),
  e("P0510", "idle", "Closed throttle position switch", "Выключатель закрытого положения дросселя: неисправность"),
  e("P0520", "oilPressure", "Engine oil pressure sensor/switch circuit", "Датчик или выключатель давления масла: неисправность цепи"),
  e("P0521", "oilPressure", "Engine oil pressure sensor/switch range/performance", "Датчик или выключатель давления масла: сигнал вне диапазона"),
  e("P0522", "oilPressure", "Engine oil pressure sensor/switch circuit low", "Датчик или выключатель давления масла: низкий уровень сигнала"),
  e("P0523", "oilPressure", "Engine oil pressure sensor/switch circuit high", "Датчик или выключатель давления масла: высокий уровень сигнала"),
  e("P0524", "oilPressure", "Engine oil pressure too low", "Давление масла двигателя слишком низкое", "urgent"),
  e("P0530", "ac", "A/C refrigerant pressure sensor circuit", "Датчик давления хладагента кондиционера: неисправность цепи"),
  e("P0531", "ac", "A/C refrigerant pressure sensor range/performance", "Датчик давления хладагента кондиционера: сигнал вне диапазона"),
  e("P0532", "ac", "A/C refrigerant pressure sensor circuit low", "Датчик давления хладагента кондиционера: низкий уровень сигнала"),
  e("P0533", "ac", "A/C refrigerant pressure sensor circuit high", "Датчик давления хладагента кондиционера: высокий уровень сигнала"),
  e("P0534", "ac", "A/C refrigerant charge loss", "Потеря хладагента кондиционера"),
  e("P0560", "voltage", "System voltage", "Напряжение бортовой сети: неисправность"),
  e("P0561", "voltage", "System voltage unstable", "Напряжение бортовой сети нестабильно"),
  e("P0562", "voltage", "System voltage low", "Напряжение бортовой сети слишком низкое"),
  e("P0563", "voltage", "System voltage high", "Напряжение бортовой сети слишком высокое"),
  e("P0571", "brakeSwitch", "Brake switch A circuit", "Выключатель стоп-сигнала A: неисправность цепи"),
  e("P0572", "brakeSwitch", "Brake switch A circuit low", "Выключатель стоп-сигнала A: низкий уровень в цепи"),
  e("P0573", "brakeSwitch", "Brake switch A circuit high", "Выключатель стоп-сигнала A: высокий уровень в цепи"),
  e("P0703", "brakeSwitch", "Brake switch B circuit", "Выключатель стоп-сигнала B: неисправность цепи"),
  e("P0600", "ecu", "Serial communication link", "Последовательный канал связи: неисправность"),
  e("P0601", "ecu", "Internal control module memory check sum error", "Блок управления: ошибка контрольной суммы памяти"),
  e("P0602", "ecu", "Control module programming error", "Блок управления: ошибка программирования"),
  e("P0603", "ecu", "Internal control module keep alive memory error", "Блок управления: ошибка памяти с постоянным питанием"),
  e("P0604", "ecu", "Internal control module random access memory (RAM) error", "Блок управления: ошибка оперативной памяти (RAM)"),
  e("P0605", "ecu", "Internal control module read only memory (ROM) error", "Блок управления: ошибка постоянной памяти (ROM)"),
  e("P0606", "ecu", "Control module processor", "Блок управления: ошибка процессора"),
  e("P0607", "ecu", "Control module performance", "Блок управления: неверная работа"),
  e("P0630", "ecu", "VIN not programmed or mismatch (ECM/PCM)", "VIN не запрограммирован или не совпадает"),
  e("P0650", "ecu", "Malfunction indicator lamp control circuit", "Лампа неисправности двигателя: неисправность цепи управления"),
  e("P0685", "ecu", "ECM/PCM power relay control circuit open", "Реле питания блока управления: обрыв цепи"),
  e("P0686", "ecu", "ECM/PCM power relay control circuit low", "Реле питания блока управления: низкий уровень в цепи"),
  e("P0687", "ecu", "ECM/PCM power relay control circuit high", "Реле питания блока управления: высокий уровень в цепи"),
  e("P0620", "charging", "Generator control circuit", "Генератор: неисправность цепи управления"),
  e("P0621", "charging", "Generator lamp L control circuit", "Лампа генератора L: неисправность цепи управления"),
  e("P0622", "charging", "Generator field F control circuit", "Обмотка возбуждения генератора F: неисправность цепи управления")
]

const transmissionEntries = [
  e("P0700", "transGeneral", "Transmission control system malfunction", "Система управления коробкой передач: неисправность"),
  e("P0701", "transGeneral", "Transmission control system range/performance", "Система управления коробкой передач: сигнал вне диапазона"),
  e("P0702", "transGeneral", "Transmission control system electrical", "Система управления коробкой передач: электрическая неисправность"),
  e("P0705", "transGeneral", "Transmission range sensor circuit (PRNDL input)", "Датчик положения селектора коробки: неисправность цепи"),
  e("P0706", "transGeneral", "Transmission range sensor circuit range/performance", "Датчик положения селектора коробки: сигнал вне диапазона"),
  e("P0707", "transGeneral", "Transmission range sensor circuit low", "Датчик положения селектора коробки: низкий уровень сигнала"),
  e("P0708", "transGeneral", "Transmission range sensor circuit high", "Датчик положения селектора коробки: высокий уровень сигнала"),
  e("P0710", "transGeneral", "Transmission fluid temperature sensor A circuit", "Датчик температуры жидкости коробки A: неисправность цепи"),
  e("P0711", "transGeneral", "Transmission fluid temperature sensor A range/performance", "Датчик температуры жидкости коробки A: сигнал вне диапазона"),
  e("P0712", "transGeneral", "Transmission fluid temperature sensor A circuit low", "Датчик температуры жидкости коробки A: низкий уровень сигнала"),
  e("P0713", "transGeneral", "Transmission fluid temperature sensor A circuit high", "Датчик температуры жидкости коробки A: высокий уровень сигнала"),
  e("P0715", "transGeneral", "Input/turbine speed sensor A circuit", "Датчик входной скорости коробки A: неисправность цепи"),
  e("P0716", "transGeneral", "Input/turbine speed sensor A range/performance", "Датчик входной скорости коробки A: сигнал вне диапазона"),
  e("P0717", "transGeneral", "Input/turbine speed sensor A no signal", "Датчик входной скорости коробки A: нет сигнала"),
  e("P0720", "transGeneral", "Output speed sensor circuit", "Датчик выходной скорости коробки: неисправность цепи"),
  e("P0721", "transGeneral", "Output speed sensor range/performance", "Датчик выходной скорости коробки: сигнал вне диапазона"),
  e("P0722", "transGeneral", "Output speed sensor no signal", "Датчик выходной скорости коробки: нет сигнала"),
  e("P0725", "transGeneral", "Engine speed input circuit", "Вход сигнала оборотов двигателя в коробку: неисправность цепи"),
  e("P0730", "transGeneral", "Incorrect gear ratio", "Неверное передаточное число"),
  e("P0731", "transGeneral", "Gear 1 incorrect ratio", "Неверное передаточное число на 1-й передаче"),
  e("P0732", "transGeneral", "Gear 2 incorrect ratio", "Неверное передаточное число на 2-й передаче"),
  e("P0733", "transGeneral", "Gear 3 incorrect ratio", "Неверное передаточное число на 3-й передаче"),
  e("P0734", "transGeneral", "Gear 4 incorrect ratio", "Неверное передаточное число на 4-й передаче"),
  e("P0735", "transGeneral", "Gear 5 incorrect ratio", "Неверное передаточное число на 5-й передаче"),
  e("P0740", "transGeneral", "Torque converter clutch circuit", "Блокировка гидротрансформатора: неисправность цепи"),
  e("P0741", "transGeneral", "Torque converter clutch circuit performance or stuck off", "Блокировка гидротрансформатора: не включается или не удерживается"),
  e("P0742", "transGeneral", "Torque converter clutch circuit stuck on", "Блокировка гидротрансформатора: застряла во включённом состоянии"),
  e("P0743", "transGeneral", "Torque converter clutch circuit electrical", "Блокировка гидротрансформатора: электрическая неисправность"),
  e("P0744", "transGeneral", "Torque converter clutch circuit intermittent", "Блокировка гидротрансформатора: нестабильная работа"),
  e("P0746", "transGeneral", "Pressure control solenoid A performance or stuck off", "Соленоид регулирования давления A: неверная работа или залипание выключенным"),
  e("P0747", "transGeneral", "Pressure control solenoid A stuck on", "Соленоид регулирования давления A: залипание включённым"),
  e("P0748", "transGeneral", "Pressure control solenoid A electrical", "Соленоид регулирования давления A: электрическая неисправность"),
  e("P0750", "transGeneral", "Shift solenoid A", "Соленоид переключения A: неисправность"),
  e("P0751", "transGeneral", "Shift solenoid A performance or stuck off", "Соленоид переключения A: неверная работа или залипание выключенным"),
  e("P0752", "transGeneral", "Shift solenoid A stuck on", "Соленоид переключения A: залипание включённым"),
  e("P0753", "transGeneral", "Shift solenoid A electrical", "Соленоид переключения A: электрическая неисправность"),
  e("P0755", "transGeneral", "Shift solenoid B", "Соленоид переключения B: неисправность"),
  e("P0756", "transGeneral", "Shift solenoid B performance or stuck off", "Соленоид переключения B: неверная работа или залипание выключенным"),
  e("P0757", "transGeneral", "Shift solenoid B stuck on", "Соленоид переключения B: залипание включённым"),
  e("P0758", "transGeneral", "Shift solenoid B electrical", "Соленоид переключения B: электрическая неисправность")
]

const networkEntries = [
  e("U0001", "netBus", "High speed CAN communication bus", "Высокоскоростная шина CAN: неисправность связи"),
  e("U0002", "netBus", "High speed CAN communication bus performance", "Высокоскоростная шина CAN: неверная работа"),
  e("U0073", "netBus", "Control module communication bus A off", "Шина связи A блоков управления отключена"),
  e("U0074", "netBus", "Control module communication bus B off", "Шина связи B блоков управления отключена"),
  e("U0100", "netModule", "Lost communication with ECM/PCM A", "Потеряна связь с блоком управления двигателем"),
  e("U0101", "netModule", "Lost communication with TCM", "Потеряна связь с блоком управления коробкой передач"),
  e("U0102", "netModule", "Lost communication with transfer case control module", "Потеряна связь с блоком управления раздаточной коробкой"),
  e("U0103", "netModule", "Lost communication with gear shift module", "Потеряна связь с модулем переключения передач"),
  e("U0104", "netModule", "Lost communication with cruise control module", "Потеряна связь с модулем круиз-контроля"),
  e("U0105", "netModule", "Lost communication with fuel injector control module", "Потеряна связь с модулем управления форсунками"),
  e("U0106", "netModule", "Lost communication with glow plug control module", "Потеряна связь с модулем управления свечами накала"),
  e("U0107", "netModule", "Lost communication with throttle actuator control module", "Потеряна связь с модулем привода дросселя"),
  e("U0108", "netModule", "Lost communication with alternative fuel control module", "Потеряна связь с модулем управления альтернативным топливом"),
  e("U0109", "netModule", "Lost communication with fuel pump control module", "Потеряна связь с модулем управления топливным насосом"),
  e("U0110", "netModule", "Lost communication with drive motor control module", "Потеряна связь с модулем управления тяговым мотором"),
  e("U0111", "netModule", "Lost communication with battery energy control module A", "Потеряна связь с модулем управления энергией аккумулятора A"),
  e("U0121", "netModule", "Lost communication with anti-lock brake system (ABS) control module", "Потеряна связь с блоком управления ABS"),
  e("U0122", "netModule", "Lost communication with vehicle dynamics control module", "Потеряна связь с модулем динамической стабилизации"),
  e("U0123", "netModule", "Lost communication with yaw rate sensor module", "Потеряна связь с модулем датчика угловой скорости рыскания"),
  e("U0124", "netModule", "Lost communication with lateral acceleration sensor module", "Потеряна связь с модулем датчика поперечного ускорения"),
  e("U0125", "netModule", "Lost communication with multi-axis acceleration sensor module", "Потеряна связь с модулем многоосевого датчика ускорения"),
  e("U0126", "netModule", "Lost communication with steering angle sensor module", "Потеряна связь с модулем датчика угла поворота руля"),
  e("U0127", "netModule", "Lost communication with tire pressure monitor module", "Потеряна связь с модулем контроля давления в шинах"),
  e("U0128", "netModule", "Lost communication with park brake control module", "Потеряна связь с модулем стояночного тормоза"),
  e("U0129", "netModule", "Lost communication with brake system control module", "Потеряна связь с модулем управления тормозной системой"),
  e("U0130", "netModule", "Lost communication with steering effort control module", "Потеряна связь с модулем управления усилием на руле"),
  e("U0131", "netModule", "Lost communication with power steering control module", "Потеряна связь с модулем управления усилителем руля"),
  e("U0132", "netModule", "Lost communication with ride level control module", "Потеряна связь с модулем управления клиренсом"),
  e("U0140", "netModule", "Lost communication with body control module", "Потеряна связь с блоком управления кузовной электроникой"),
  e("U0141", "netModule", "Lost communication with body control module A", "Потеряна связь с блоком управления кузовной электроникой A"),
  e("U0142", "netModule", "Lost communication with body control module B", "Потеряна связь с блоком управления кузовной электроникой B"),
  e("U0146", "netModule", "Lost communication with gateway A", "Потеряна связь со шлюзом A"),
  e("U0151", "netModule", "Lost communication with restraints control module", "Потеряна связь с блоком управления подушками безопасности"),
  e("U0155", "netModule", "Lost communication with instrument panel cluster control module", "Потеряна связь с блоком приборной панели"),
  e("U0164", "netModule", "Lost communication with HVAC control module", "Потеряна связь с блоком управления климатом"),
  e("U0168", "netModule", "Lost communication with vehicle security control module", "Потеряна связь с модулем охранной системы автомобиля"),
  e("U0184", "netModule", "Lost communication with radio", "Потеряна связь с радиоприёмником"),
  e("U0401", "netInvalid", "Invalid data received from ECM/PCM A", "Получены недопустимые данные от блока управления двигателем"),
  e("U0402", "netInvalid", "Invalid data received from TCM", "Получены недопустимые данные от блока управления коробкой передач"),
  e("U0415", "netInvalid", "Invalid data received from anti-lock brake system (ABS) control module", "Получены недопустимые данные от блока управления ABS")
]

export const CATALOG: ReadonlyArray<CatalogEntry> = [
  ...vvtEntries,
  ...o2HeaterEntries,
  ...fuelEntries,
  ...airEntries,
  ...o2Entries,
  ...trimEntries,
  ...injectorEntries,
  ...injectorLowHighEntries,
  ...ignitionEntries,
  ...emissionEntries,
  ...boostEntries,
  ...controlEntries,
  ...transmissionEntries,
  ...networkEntries
]

export const catalogCodes: ReadonlyArray<string> = CATALOG.map((c) => c.code)
