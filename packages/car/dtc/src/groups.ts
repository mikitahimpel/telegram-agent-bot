import type { Severity } from "@bot/car-format/insights"

export type GroupText = {
  readonly meaning: string
  readonly causes: ReadonlyArray<string>
  readonly todo: string
  readonly drive: string
}

export type Group = {
  readonly severity: Severity
  readonly en: GroupText
  readonly ru: GroupText
}

const DRIVE_OK_EN = "You can drive, but have it checked soon."
const DRIVE_OK_RU = "Ехать можно, но проверьте автомобиль в ближайшее время."
const DRIVE_CARE_EN =
  "You can drive carefully to a service. Stop if the engine runs rough, a warning light flashes or the temperature rises."
const DRIVE_CARE_RU =
  "Можно аккуратно доехать до сервиса. Остановитесь, если двигатель трясётся, мигает индикатор или растёт температура."

export const GROUPS = {
  maf: {
    severity: "watch",
    en: {
      meaning:
        "The mass air flow sensor measures how much air enters the engine. The computer sees a wrong or missing signal, so the fuel mixture may be inaccurate.",
      causes: [
        "Dirty or failing air flow sensor",
        "Air leak after the sensor or a damaged intake hose",
        "Clogged air filter",
        "Bad connector or wiring"
      ],
      todo: "Check the air filter and intake hoses for cracks, then have the sensor and its wiring checked. Do not clear the code before diagnosis.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Датчик массового расхода воздуха измеряет, сколько воздуха попадает в двигатель. Компьютер получает неверный или пропавший сигнал, поэтому состав смеси может быть неточным.",
      causes: [
        "Загрязнённый или неисправный датчик расхода воздуха",
        "Подсос воздуха после датчика или повреждённый патрубок",
        "Забитый воздушный фильтр",
        "Плохой разъём или проводка"
      ],
      todo: "Проверьте воздушный фильтр и патрубки на трещины, затем проверьте датчик и его проводку. Не стирайте ошибку до диагностики.",
      drive: DRIVE_OK_RU
    }
  },
  map: {
    severity: "watch",
    en: {
      meaning:
        "The manifold pressure sensor tells the computer how much load the engine has. The signal is out of range or inconsistent.",
      causes: [
        "Failing pressure sensor",
        "Vacuum hose leak or loose hose",
        "Intake air leak",
        "Wiring or connector fault"
      ],
      todo: "Check the vacuum hose to the sensor and the intake for leaks, then have the sensor and wiring tested.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Датчик давления во впускном коллекторе сообщает компьютеру нагрузку двигателя. Сигнал вне допустимых пределов или нелогичен.",
      causes: [
        "Неисправный датчик давления",
        "Негерметичная или соскочившая вакуумная трубка",
        "Подсос воздуха во впуске",
        "Неисправность проводки или разъёма"
      ],
      todo: "Проверьте вакуумную трубку к датчику и впуск на герметичность, затем проверьте датчик и проводку.",
      drive: DRIVE_OK_RU
    }
  },
  iat: {
    severity: "info",
    en: {
      meaning:
        "The intake air temperature sensor reports an implausible value. The computer uses it to fine-tune fuel, so efficiency may suffer slightly.",
      causes: ["Failing temperature sensor", "Bad connector or wiring", "Dirt or damage near the air intake"],
      todo: "Inspect the sensor connector and wiring; replace the sensor if the fault stays.",
      drive: "You can drive normally, but have it checked at the next service."
    },
    ru: {
      meaning:
        "Датчик температуры воздуха на впуске выдаёт неправдоподобное значение. Компьютер использует его для тонкой подстройки топлива, поэтому экономичность может немного падать.",
      causes: [
        "Неисправный датчик температуры",
        "Плохой разъём или проводка",
        "Загрязнение или повреждение рядом с воздухозаборником"
      ],
      todo: "Осмотрите разъём и проводку датчика; если ошибка остаётся, замените датчик.",
      drive: "Ехать можно в обычном режиме, но проверьте при ближайшем обслуживании."
    }
  },
  ect: {
    severity: "soon",
    en: {
      meaning:
        "The coolant temperature sensor gives a wrong or missing reading. The computer uses it for fuel mixture, the cooling fan and engine protection.",
      causes: ["Failing coolant temperature sensor", "Bad connector or wiring", "Low coolant level"],
      todo: "Check the coolant level when the engine is cold and watch the temperature gauge. Have the sensor and wiring checked.",
      drive: "Drive carefully and watch the temperature gauge. Stop if it climbs toward red."
    },
    ru: {
      meaning:
        "Датчик температуры охлаждающей жидкости даёт неверные показания или пропал. Компьютер использует его для состава смеси, вентилятора и защиты двигателя.",
      causes: [
        "Неисправный датчик температуры охлаждающей жидкости",
        "Плохой разъём или проводка",
        "Низкий уровень охлаждающей жидкости"
      ],
      todo: "Проверьте уровень охлаждающей жидкости на холодном двигателе и следите за указателем температуры. Проверьте датчик и проводку.",
      drive: "Ехать осторожно, следите за указателем температуры. Остановитесь, если он идёт к красной зоне."
    }
  },
  warmup: {
    severity: "watch",
    en: {
      meaning:
        "The engine is not reaching or holding its normal operating temperature in the expected time. Fuel use rises and the cabin heater may be weak.",
      causes: [
        "Thermostat stuck open",
        "Failing coolant temperature sensor",
        "Low coolant level",
        "Very cold weather or short trips"
      ],
      todo: "If the temperature gauge stays low on longer drives, replace the thermostat. Check the coolant level.",
      drive: "You can drive. Fuel use and engine wear increase if it stays cold, so repair it within weeks."
    },
    ru: {
      meaning:
        "Двигатель не достигает или не держит нормальную рабочую температуру за ожидаемое время. Расход топлива растёт, печка может греть слабо.",
      causes: [
        "Термостат застрял в открытом положении",
        "Неисправный датчик температуры охлаждающей жидкости",
        "Низкий уровень охлаждающей жидкости",
        "Сильный мороз или короткие поездки"
      ],
      todo: "Если указатель температуры остаётся низким и на длинных поездках, замените термостат. Проверьте уровень охлаждающей жидкости.",
      drive:
        "Ехать можно. Если двигатель остаётся холодным, растут расход и износ, поэтому устраните в течение нескольких недель."
    }
  },
  throttle: {
    severity: "soon",
    en: {
      meaning:
        "The electronic throttle or accelerator pedal system has a sensor or control fault. The car may have reduced power or an unstable idle.",
      causes: [
        "Dirty or failing throttle body",
        "Failing throttle or pedal position sensor",
        "Wiring or connector fault",
        "Low battery voltage"
      ],
      todo: "Have the throttle body cleaned and the pedal and throttle sensors tested. Stop driving if power drops suddenly in traffic.",
      drive: "Drive carefully: the car may lose power or go into limp mode. Get it checked soon."
    },
    ru: {
      meaning:
        "В системе электронной дроссельной заслонки или педали газа неисправен датчик или привод. Возможны потеря мощности или нестабильный холостой ход.",
      causes: [
        "Загрязнённый или неисправный дроссельный узел",
        "Неисправный датчик положения дроссельной заслонки или педали",
        "Неисправность проводки или разъёма",
        "Низкое напряжение аккумулятора"
      ],
      todo: "Очистите дроссельный узел и проверьте датчики педали и заслонки. Не продолжайте движение, если мощность резко пропадает в потоке.",
      drive: "Ехать осторожно: возможны потеря мощности и аварийный режим. Проверьте в ближайшее время."
    }
  },
  o2: {
    severity: "watch",
    en: {
      meaning:
        "The oxygen (lambda) sensor in the exhaust has a circuit fault, a slow or flat response. The computer cannot tune the mixture precisely, so fuel use and emissions may rise.",
      causes: [
        "Worn or contaminated oxygen sensor",
        "Exhaust leak near the sensor",
        "Damaged wiring or connector",
        "Engine running too rich or too lean"
      ],
      todo: "Check for exhaust leaks and sensor wiring, then replace the sensor if the fault is confirmed. Fix any misfire or mixture code first.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Кислородный датчик (лямбда-зонд) в выпуске имеет неисправность цепи, медленный или нулевой отклик. Компьютер не может точно настроить смесь, расход топлива и выбросы могут вырасти.",
      causes: [
        "Изношенный или загрязнённый кислородный датчик",
        "Утечка выхлопа рядом с датчиком",
        "Повреждённая проводка или разъём",
        "Слишком богатая или бедная смесь"
      ],
      todo: "Проверьте выпуск на утечки и проводку датчика, при подтверждении замените датчик. Сначала устраните коды пропусков зажигания и состава смеси.",
      drive: DRIVE_OK_RU
    }
  },
  o2heater: {
    severity: "watch",
    en: {
      meaning:
        "The heater inside the oxygen sensor is not working properly. The sensor takes longer to warm up, so emissions and fuel use may rise after a cold start.",
      causes: ["Failed sensor heater", "Blown fuse", "Wiring or connector fault"],
      todo: "Check the fuse and wiring; the sensor usually needs replacing.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Нагреватель внутри кислородного датчика работает неправильно. Датчик дольше прогревается, после холодного пуска выбросы и расход могут быть выше.",
      causes: [
        "Вышел из строя нагреватель датчика",
        "Перегоревший предохранитель",
        "Неисправность проводки или разъёма"
      ],
      todo: "Проверьте предохранитель и проводку; обычно требуется замена датчика.",
      drive: DRIVE_OK_RU
    }
  },
  trimLean: {
    severity: "watch",
    en: {
      meaning:
        "The engine is getting too much air or too little fuel (lean mixture) and the computer cannot fully correct it.",
      causes: [
        "Air leak in the intake or a vacuum hose",
        "Dirty air flow sensor",
        "Weak fuel pump or clogged fuel filter",
        "Dirty or weak injectors",
        "Exhaust leak before the oxygen sensor"
      ],
      todo: "Check intake hoses and the air flow sensor first, then fuel pressure. A lean engine can overheat, so do not ignore it for long.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "В двигатель попадает слишком много воздуха или слишком мало топлива (бедная смесь), и компьютер не может полностью это скомпенсировать.",
      causes: [
        "Подсос воздуха во впуске или вакуумной трубке",
        "Загрязнённый датчик расхода воздуха",
        "Слабый топливный насос или забитый топливный фильтр",
        "Загрязнённые или слабые форсунки",
        "Утечка выхлопа до кислородного датчика"
      ],
      todo: "Сначала проверьте патрубки впуска и датчик расхода воздуха, затем давление топлива. Бедная смесь может перегревать двигатель, не откладывайте надолго.",
      drive: DRIVE_CARE_RU
    }
  },
  trimRich: {
    severity: "watch",
    en: {
      meaning:
        "The engine is getting too much fuel or too little air (rich mixture) and the computer cannot fully correct it. Fuel use rises.",
      causes: [
        "Leaking or stuck-open injector",
        "Dirty air filter",
        "Faulty air flow or oxygen sensor",
        "Too high fuel pressure",
        "Stuck purge valve"
      ],
      todo: "Check the air filter, sensors and fuel pressure. A rich mixture over time can damage the catalytic converter.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "В двигатель попадает слишком много топлива или слишком мало воздуха (богатая смесь), и компьютер не может полностью это скомпенсировать. Расход топлива растёт.",
      causes: [
        "Подтекающая или залипшая форсунка",
        "Загрязнённый воздушный фильтр",
        "Неисправный датчик расхода воздуха или кислородный датчик",
        "Слишком высокое давление топлива",
        "Залипший клапан продувки адсорбера"
      ],
      todo: "Проверьте воздушный фильтр, датчики и давление топлива. Длительная богатая смесь может повредить катализатор.",
      drive: DRIVE_CARE_RU
    }
  },
  trimOther: {
    severity: "watch",
    en: {
      meaning:
        "The fuel mixture correction (fuel trim) is outside its normal range, or the post-catalyst mixture check failed.",
      causes: [
        "Air leak or exhaust leak",
        "Faulty air flow or oxygen sensor",
        "Fuel delivery problem",
        "Worn catalytic converter"
      ],
      todo: "Have the mixture checked with a scanner: look at fuel trim values, intake leaks and fuel pressure.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Коррекция топливоподачи вышла за нормальные пределы, либо не пройдена проверка смеси после катализатора.",
      causes: [
        "Подсос воздуха или утечка выхлопа",
        "Неисправный датчик расхода воздуха или кислородный датчик",
        "Проблема с подачей топлива",
        "Изношенный катализатор"
      ],
      todo: "Проведите диагностику сканером: проверьте значения коррекции топлива, подсос воздуха и давление топлива.",
      drive: DRIVE_OK_RU
    }
  },
  fuelPressure: {
    severity: "soon",
    en: {
      meaning:
        "Fuel pressure or the fuel pressure sensor or regulator is out of range. The engine may lack power, hesitate or be hard to start.",
      causes: [
        "Weak fuel pump or clogged fuel filter",
        "Faulty pressure sensor or regulator",
        "Fuel leak",
        "Wiring fault"
      ],
      todo: "Have the fuel pressure measured and the fuel filter checked. Fix any visible fuel leak immediately: it is a fire risk.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "Давление топлива, его датчик или регулятор вне допустимых пределов. Возможны слабая тяга, провалы и трудный пуск.",
      causes: [
        "Слабый топливный насос или забитый топливный фильтр",
        "Неисправный датчик или регулятор давления",
        "Утечка топлива",
        "Неисправность проводки"
      ],
      todo: "Измерьте давление топлива и проверьте топливный фильтр. Видимую утечку топлива устраните немедленно: это пожароопасно.",
      drive: DRIVE_CARE_RU
    }
  },
  fuelPump: {
    severity: "soon",
    en: {
      meaning: "The fuel pump control circuit has a fault. The engine may stall, lose power or not start.",
      causes: ["Failing fuel pump", "Blown fuse or bad relay", "Wiring or connector fault", "Low battery voltage"],
      todo: "Check the fuse and relay, then the pump and wiring. If the engine stalls at speed, do not keep driving.",
      drive: "The engine may stall without warning. Drive only a short distance to a service if the car runs normally."
    },
    ru: {
      meaning:
        "В цепи управления топливным насосом есть неисправность. Двигатель может глохнуть, терять мощность или не запускаться.",
      causes: [
        "Изношенный топливный насос",
        "Перегоревший предохранитель или плохое реле",
        "Неисправность проводки или разъёма",
        "Низкое напряжение аккумулятора"
      ],
      todo: "Проверьте предохранитель и реле, затем насос и проводку. Если двигатель глохнет на ходу, не продолжайте движение.",
      drive:
        "Двигатель может заглохнуть без предупреждения. Если машина едет нормально, добирайтесь до сервиса только на короткое расстояние."
    }
  },
  injector: {
    severity: "soon",
    en: {
      meaning:
        "A fuel injector circuit has an electrical fault. That cylinder may get too much or too little fuel, causing rough running.",
      causes: ["Failing injector", "Wiring or connector fault", "Faulty engine computer driver (rare)"],
      todo: "Have the injector, its connector and wiring tested. Avoid long drives with a rough engine: unburnt fuel damages the catalytic converter.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "В цепи топливной форсунки есть электрическая неисправность. Цилиндр может получать слишком много или слишком мало топлива, двигатель работает неровно.",
      causes: [
        "Неисправная форсунка",
        "Неисправность проводки или разъёма",
        "Неисправный выходной каскад блока управления (редко)"
      ],
      todo: "Проверьте форсунку, разъём и проводку. Избегайте долгих поездок при неровной работе: несгоревшее топливо разрушает катализатор.",
      drive: DRIVE_CARE_RU
    }
  },
  misfire: {
    severity: "urgent",
    en: {
      meaning:
        "The engine is misfiring: one or more cylinders are not burning fuel properly. Unburnt fuel can overheat and destroy the catalytic converter.",
      causes: [
        "Worn spark plugs",
        "Failing ignition coil",
        "Leaking or clogged injector",
        "Air leak or low compression",
        "Poor quality fuel"
      ],
      todo: "If the check engine light flashes, stop driving as soon as it is safe and reduce load. Otherwise have the spark plugs, coils and injectors checked in the next days. Do not ignore it.",
      drive:
        "Avoid long drives. If the check engine light flashes, drive gently without hard acceleration to the nearest service or stop."
    },
    ru: {
      meaning:
        "Двигатель пропускает зажигание: один или несколько цилиндров неполноценно сжигают топливо. Несгоревшее топливо может перегреть и разрушить катализатор.",
      causes: [
        "Изношенные свечи зажигания",
        "Неисправная катушка зажигания",
        "Подтекающая или забитая форсунка",
        "Подсос воздуха или низкая компрессия",
        "Некачественное топливо"
      ],
      todo: "Если индикатор двигателя мигает, остановитесь при первой возможности и снизьте нагрузку. Иначе проверьте свечи, катушки и форсунки в ближайшие дни. Не игнорируйте.",
      drive:
        "Избегайте дальних поездок. Если индикатор мигает, езжайте плавно, без резких разгонов, до ближайшего сервиса или остановитесь."
    }
  },
  knock: {
    severity: "soon",
    en: {
      meaning: "The knock sensor, which listens for harmful detonation in the engine, has a circuit fault.",
      causes: ["Failing knock sensor", "Damaged wiring or connector", "Loose sensor mounting"],
      todo: "Check the sensor wiring and mounting. Without it the engine reduces power to protect itself, so have it fixed soon.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning: "В цепи датчика детонации, который «слушает» вредную детонацию двигателя, есть неисправность.",
      causes: ["Неисправный датчик детонации", "Повреждённая проводка или разъём", "Ослабленное крепление датчика"],
      todo: "Проверьте проводку и крепление датчика. Без него двигатель снижает мощность для защиты, поэтому устраните неисправность в ближайшее время.",
      drive: DRIVE_CARE_RU
    }
  },
  crank: {
    severity: "soon",
    en: {
      meaning:
        "The crankshaft position sensor, which tells the computer engine speed and position, gives a bad signal. The engine may stall or not start.",
      causes: [
        "Failing crankshaft sensor",
        "Damaged wiring or connector",
        "Damaged reluctor ring",
        "Low battery voltage"
      ],
      todo: "Have the sensor and wiring checked. The engine may stall suddenly, so do not delay.",
      drive: "The engine may stall or fail to restart. Drive only a short distance to a service."
    },
    ru: {
      meaning:
        "Датчик положения коленчатого вала, сообщающий компьютеру обороты и положение двигателя, даёт плохой сигнал. Двигатель может глохнуть или не запускаться.",
      causes: [
        "Неисправный датчик коленвала",
        "Повреждённая проводка или разъём",
        "Повреждённый задающий диск",
        "Низкое напряжение аккумулятора"
      ],
      todo: "Проверьте датчик и проводку. Двигатель может внезапно заглохнуть, не откладывайте.",
      drive: "Двигатель может заглохнуть или не завестись снова. Ехать только на короткое расстояние до сервиса."
    }
  },
  cam: {
    severity: "soon",
    en: {
      meaning: "The camshaft position sensor has a fault. The engine may be hard to start, run rough or use more fuel.",
      causes: [
        "Failing camshaft sensor",
        "Wiring or connector fault",
        "Stretched timing chain or belt",
        "Low oil level or dirty oil"
      ],
      todo: "Have the sensor and wiring tested and the timing checked if the fault repeats.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "Датчик положения распредвала неисправен. Двигатель может плохо запускаться, работать неровно или расходовать больше топлива.",
      causes: [
        "Неисправный датчик распредвала",
        "Неисправность проводки или разъёма",
        "Растянутая цепь или ремень ГРМ",
        "Низкий уровень или загрязнённое масло"
      ],
      todo: "Проверьте датчик и проводку, при повторении ошибки проверьте фазы ГРМ.",
      drive: DRIVE_CARE_RU
    }
  },
  vvt: {
    severity: "soon",
    en: {
      meaning:
        "The variable valve timing system does not move as commanded or the camshaft and crankshaft positions do not match.",
      causes: ["Low or dirty engine oil", "Faulty valve timing solenoid", "Stretched timing chain", "Wiring fault"],
      todo: "Check the oil level and change the oil if it is old. If the code stays, have the solenoid and timing checked.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "Система изменения фаз газораспределения не отрабатывает команду, либо положения распредвала и коленвала не совпадают.",
      causes: [
        "Низкий уровень или грязное моторное масло",
        "Неисправный соленоид фаз ГРМ",
        "Растянутая цепь ГРМ",
        "Неисправность проводки"
      ],
      todo: "Проверьте уровень масла и замените его, если оно старое. Если ошибка остаётся, проверьте соленоид и фазы ГРМ.",
      drive: DRIVE_CARE_RU
    }
  },
  coil: {
    severity: "soon",
    en: {
      meaning: "An ignition coil circuit has a fault. That cylinder may misfire.",
      causes: ["Failing ignition coil", "Worn spark plug", "Wiring or connector fault"],
      todo: "Swap the coil with a neighbour to see if the fault follows it, and replace the spark plugs. Avoid long drives with a misfire.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning: "В цепи катушки зажигания есть неисправность. Цилиндр может пропускать зажигание.",
      causes: ["Неисправная катушка зажигания", "Изношенная свеча", "Неисправность проводки или разъёма"],
      todo: "Поменяйте катушку местами с соседней, чтобы понять, уходит ли ошибка вместе с ней, и замените свечи. Избегайте долгих поездок при пропусках.",
      drive: DRIVE_CARE_RU
    }
  },
  glow: {
    severity: "soon",
    en: {
      meaning: "The diesel glow plug system has a fault. Cold starts may be hard and the engine may smoke until warm.",
      causes: ["Burnt glow plug", "Glow plug relay or control module fault", "Wiring fault"],
      todo: "Have the glow plugs and their relay tested before winter.",
      drive: "You can drive once the engine is running, but cold starts may fail."
    },
    ru: {
      meaning:
        "В системе свечей накала дизеля есть неисправность. Холодный пуск может быть тяжёлым, пока двигатель не прогреется, возможен дым.",
      causes: [
        "Перегоревшая свеча накала",
        "Неисправность реле или блока управления свечами",
        "Неисправность проводки"
      ],
      todo: "Проверьте свечи накала и реле до наступления зимы.",
      drive: "Когда двигатель завёлся, ехать можно, но холодный пуск может не получиться."
    }
  },
  egr: {
    severity: "soon",
    en: {
      meaning:
        "The exhaust gas recirculation (EGR) system, which returns some exhaust to the intake to cut emissions, has too little or too much flow or an electrical fault.",
      causes: ["Clogged EGR valve or passages", "Stuck EGR valve", "Faulty EGR sensor or wiring", "Vacuum line leak"],
      todo: "Have the EGR valve cleaned or replaced. A stuck-open valve can cause rough idle.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Система рециркуляции отработавших газов (EGR), возвращающая часть выхлопа во впуск для снижения выбросов, пропускает слишком мало или слишком много газа либо неисправна электрически.",
      causes: [
        "Закоксованный клапан или каналы EGR",
        "Заклинивший клапан EGR",
        "Неисправный датчик или проводка EGR",
        "Негерметичная вакуумная трубка"
      ],
      todo: "Очистите или замените клапан EGR. Клапан, застрявший открытым, вызывает неровный холостой ход.",
      drive: DRIVE_OK_RU
    }
  },
  airPump: {
    severity: "watch",
    en: {
      meaning: "The secondary air injection system, which helps clean exhaust after a cold start, has a fault.",
      causes: ["Failed air pump or its relay", "Stuck valve", "Blocked air passages or hoses", "Wiring fault"],
      todo: "Have the air pump, valve and fuses checked. It only affects emissions after cold start.",
      drive: "You can drive normally."
    },
    ru: {
      meaning: "Система вторичной подачи воздуха, помогающая очищать выхлоп после холодного пуска, неисправна.",
      causes: [
        "Вышел из строя насос вторичного воздуха или его реле",
        "Заклинивший клапан",
        "Забитые каналы или шланги",
        "Неисправность проводки"
      ],
      todo: "Проверьте насос, клапан и предохранители. Влияет только на выбросы после холодного пуска.",
      drive: "Ехать можно в обычном режиме."
    }
  },
  catalyst: {
    severity: "soon",
    en: {
      meaning: "The catalytic converter cleans exhaust less efficiently than required.",
      causes: [
        "Worn catalytic converter",
        "Misfires or a rich mixture that damaged it",
        "Exhaust leak near the oxygen sensors",
        "Failing downstream oxygen sensor"
      ],
      todo: "First fix any misfire or mixture codes and exhaust leaks, then check the oxygen sensors. The converter may need replacing.",
      drive: "You can drive, but emissions are high and a failing converter can restrict the exhaust over time."
    },
    ru: {
      meaning: "Катализатор очищает выхлоп хуже, чем требуется.",
      causes: [
        "Изношенный катализатор",
        "Пропуски зажигания или богатая смесь, которые его повредили",
        "Утечка выхлопа около кислородных датчиков",
        "Неисправный задний кислородный датчик"
      ],
      todo: "Сначала устраните коды пропусков зажигания и смеси и утечки выхлопа, затем проверьте кислородные датчики. Возможно, потребуется замена катализатора.",
      drive: "Ехать можно, но выбросы высокие, а изношенный катализатор со временем может затруднять выпуск."
    }
  },
  evapLeak: {
    severity: "info",
    en: {
      meaning:
        "The fuel vapour (EVAP) system has a leak or is not sealed. Fuel vapour may escape, but the engine itself is usually unaffected.",
      causes: [
        "Loose, missing or worn fuel cap",
        "Cracked vapour hose",
        "Faulty purge or vent valve",
        "Leaking charcoal canister"
      ],
      todo: "First check that the fuel cap is tight and its seal is intact; tighten or replace it. Driving a few days may clear the code; if it returns, have the system smoke-tested.",
      drive: "You can drive normally."
    },
    ru: {
      meaning:
        "Система улавливания паров топлива (EVAP) негерметична. Пары топлива могут уходить в атмосферу, но на работу двигателя обычно это не влияет.",
      causes: [
        "Не закрыта, потеряна или изношена крышка бака",
        "Треснувший шланг паров",
        "Неисправный клапан продувки или вентиляции",
        "Негерметичный адсорбер"
      ],
      todo: "Сначала проверьте, что крышка бака плотно закрыта и уплотнение цело; затяните или замените. Через несколько дней езды ошибка может уйти; если вернётся, проверьте систему дымогенератором.",
      drive: "Ехать можно в обычном режиме."
    }
  },
  evapValve: {
    severity: "watch",
    en: {
      meaning:
        "A valve, sensor or flow in the fuel vapour (EVAP) system is faulty. It can cause rough idle after refuelling or a hard start.",
      causes: [
        "Stuck or failing purge valve",
        "Stuck vent valve",
        "Faulty pressure sensor",
        "Wiring fault or blocked hose"
      ],
      todo: "Check the fuel cap and vapour hoses, then have the valves and sensor tested.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Клапан, датчик или поток в системе улавливания паров топлива (EVAP) неисправен. Возможны неровный холостой ход после заправки или трудный пуск.",
      causes: [
        "Залипший или неисправный клапан продувки",
        "Залипший клапан вентиляции",
        "Неисправный датчик давления",
        "Неисправность проводки или забитый шланг"
      ],
      todo: "Проверьте крышку бака и шланги паров, затем проверьте клапаны и датчик.",
      drive: DRIVE_OK_RU
    }
  },
  fuelLevel: {
    severity: "info",
    en: {
      meaning: "The fuel level sensor signal is wrong. The fuel gauge may be inaccurate.",
      causes: ["Failing sender in the fuel tank", "Wiring or connector fault", "Corroded contacts"],
      todo: "Do not rely on the fuel gauge: refuel by the trip meter. Have the sender checked at the next service.",
      drive: "You can drive, but track fuel by mileage."
    },
    ru: {
      meaning: "Сигнал датчика уровня топлива неверен. Указатель топлива может врать.",
      causes: ["Неисправный датчик в баке", "Неисправность проводки или разъёма", "Окисленные контакты"],
      todo: "Не полагайтесь на указатель: заправляйтесь по пробегу. Проверьте датчик при ближайшем обслуживании.",
      drive: "Ехать можно, но следите за топливом по пробегу."
    }
  },
  fan: {
    severity: "soon",
    en: {
      meaning:
        "The engine cooling fan or its control circuit has a fault. The engine may overheat in traffic or at idle.",
      causes: ["Failed fan motor", "Blown fuse or bad relay", "Faulty temperature sensor", "Wiring fault"],
      todo: "Check the fan fuse, relay and motor. Watch the temperature gauge, especially in traffic and in summer.",
      drive: "Drive with care and watch the temperature gauge. Stop if it climbs toward red."
    },
    ru: {
      meaning:
        "Вентилятор охлаждения двигателя или его цепь управления неисправны. Двигатель может перегреваться в пробках и на холостом ходу.",
      causes: [
        "Вышел из строя электродвигатель вентилятора",
        "Перегоревший предохранитель или плохое реле",
        "Неисправный датчик температуры",
        "Неисправность проводки"
      ],
      todo: "Проверьте предохранитель, реле и мотор вентилятора. Следите за указателем температуры, особенно в пробках и летом.",
      drive: "Ехать осторожно, следите за указателем температуры. Остановитесь, если он идёт к красной зоне."
    }
  },
  speed: {
    severity: "watch",
    en: {
      meaning:
        "The vehicle speed sensor signal is missing or implausible. The speedometer, cruise control and automatic gearbox may misbehave.",
      causes: [
        "Failing speed sensor",
        "Wiring or connector fault",
        "Faulty ABS wheel speed sensor",
        "Dirty sensor or reluctor ring"
      ],
      todo: "Have the speed sensor and wiring checked. Compare the speedometer with a phone GPS speed.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Сигнал датчика скорости автомобиля пропал или неправдоподобен. Спидометр, круиз-контроль и автоматическая коробка могут работать неправильно.",
      causes: [
        "Неисправный датчик скорости",
        "Неисправность проводки или разъёма",
        "Неисправный датчик ABS колеса",
        "Загрязнение датчика или диска"
      ],
      todo: "Проверьте датчик скорости и проводку. Сравните спидометр со скоростью по GPS на телефоне.",
      drive: DRIVE_OK_RU
    }
  },
  idle: {
    severity: "watch",
    en: {
      meaning:
        "The idle speed control is not keeping the engine at its target idle speed. The engine may idle too high, too low or stall.",
      causes: [
        "Dirty throttle body or idle valve",
        "Vacuum or air leak",
        "Failing idle air control valve",
        "Low battery voltage"
      ],
      todo: "Have the throttle body cleaned and the intake checked for air leaks.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "Система регулировки холостого хода не держит целевые обороты. Двигатель может работать на слишком высоких или низких оборотах или глохнуть.",
      causes: [
        "Загрязнённый дроссельный узел или клапан холостого хода",
        "Подсос воздуха или вакуумная утечка",
        "Неисправный регулятор холостого хода",
        "Низкое напряжение аккумулятора"
      ],
      todo: "Очистите дроссельный узел и проверьте впуск на подсос воздуха.",
      drive: DRIVE_OK_RU
    }
  },
  oilPressure: {
    severity: "soon",
    en: {
      meaning: "The engine oil pressure sensor or switch reports a fault or an abnormal pressure.",
      causes: ["Low oil level", "Failing oil pressure sensor", "Worn oil pump or engine", "Wiring fault"],
      todo: "Stop and check the oil level now. If the oil light is on, do not drive. If the level is fine, have the sensor and real pressure tested.",
      drive: "Check the oil level before driving. If the oil pressure light is on, do not drive."
    },
    ru: {
      meaning: "Датчик или выключатель давления масла сообщает о неисправности или ненормальном давлении.",
      causes: [
        "Низкий уровень масла",
        "Неисправный датчик давления масла",
        "Износ масляного насоса или двигателя",
        "Неисправность проводки"
      ],
      todo: "Остановитесь и сразу проверьте уровень масла. Если горит лампа давления масла, не ездите. Если уровень в норме, проверьте датчик и реальное давление.",
      drive: "Перед поездкой проверьте уровень масла. Если горит лампа давления масла, ехать нельзя."
    }
  },
  oilTemp: {
    severity: "watch",
    en: {
      meaning: "The engine oil temperature sensor reading is implausible.",
      causes: ["Failing oil temperature sensor", "Wiring or connector fault"],
      todo: "Have the sensor and wiring checked at the next service.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning: "Показания датчика температуры моторного масла неправдоподобны.",
      causes: ["Неисправный датчик температуры масла", "Неисправность проводки или разъёма"],
      todo: "Проверьте датчик и проводку при ближайшем обслуживании.",
      drive: DRIVE_OK_RU
    }
  },
  voltage: {
    severity: "soon",
    en: {
      meaning:
        "The system voltage is out of the normal range or unstable. A weak battery or charging problem can trigger many other faults.",
      causes: [
        "Weak or old battery",
        "Failing alternator or regulator",
        "Corroded or loose battery terminals",
        "Damaged wiring or poor ground"
      ],
      todo: "Check the battery and terminals and measure charging voltage with the engine running (normally about 13.8 to 14.4 V). Fix this before chasing other codes.",
      drive: "If the battery light is on or voltage drops, the car may stop. Drive only a short distance to a service."
    },
    ru: {
      meaning:
        "Напряжение бортовой сети вне нормы или нестабильно. Слабый аккумулятор или проблема с зарядкой могут вызывать множество других ошибок.",
      causes: [
        "Слабый или старый аккумулятор",
        "Неисправный генератор или регулятор напряжения",
        "Окисленные или ослабленные клеммы",
        "Повреждённая проводка или плохая масса"
      ],
      todo: "Проверьте аккумулятор и клеммы и измерьте напряжение зарядки при работающем двигателе (обычно около 13,8–14,4 В). Устраните это до поиска остальных ошибок.",
      drive:
        "Если горит лампа аккумулятора или напряжение падает, машина может встать. Ехать только на короткое расстояние до сервиса."
    }
  },
  charging: {
    severity: "soon",
    en: {
      meaning: "The alternator (generator) control circuit has a fault. The battery may not charge properly.",
      causes: ["Failing alternator or voltage regulator", "Wiring or connector fault", "Loose or worn drive belt"],
      todo: "Measure charging voltage with the engine running and check the belt and wiring.",
      drive: "The battery may drain while driving. Drive only a short distance to a service."
    },
    ru: {
      meaning: "В цепи управления генератором есть неисправность. Аккумулятор может не заряжаться должным образом.",
      causes: [
        "Неисправный генератор или регулятор напряжения",
        "Неисправность проводки или разъёма",
        "Ослабленный или изношенный приводной ремень"
      ],
      todo: "Измерьте напряжение зарядки при работающем двигателе и проверьте ремень и проводку.",
      drive: "Аккумулятор может разряжаться на ходу. Ехать только на короткое расстояние до сервиса."
    }
  },
  ecu: {
    severity: "soon",
    en: {
      meaning: "The engine control computer reports an internal, memory, power or configuration fault.",
      causes: [
        "Low battery voltage or poor ground",
        "Faulty engine computer",
        "Software or coding problem",
        "Wiring or relay fault"
      ],
      todo: "Check battery, ground connections and fuses first. If the code stays, the computer needs diagnosis or reprogramming by a specialist.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "Блок управления двигателем сообщает о внутренней неисправности, ошибке памяти, питания или конфигурации.",
      causes: [
        "Низкое напряжение аккумулятора или плохая масса",
        "Неисправный блок управления",
        "Проблема программного обеспечения или кодирования",
        "Неисправность проводки или реле"
      ],
      todo: "Сначала проверьте аккумулятор, массу и предохранители. Если ошибка остаётся, блок требует диагностики или перепрошивки у специалиста.",
      drive: DRIVE_CARE_RU
    }
  },
  overspeed: {
    severity: "soon",
    en: {
      meaning: "The engine revolved faster than the allowed limit at some moment.",
      causes: ["Missed gear shift or downshift at high speed", "Sensor or control fault"],
      todo: "If you did not over-rev the engine yourself, have the throttle and transmission checked.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning: "В какой-то момент двигатель превысил допустимые обороты.",
      causes: ["Ошибочное включение пониженной передачи на высокой скорости", "Неисправность датчика или управления"],
      todo: "Если вы сами не перекручивали двигатель, проверьте дроссель и коробку передач.",
      drive: DRIVE_CARE_RU
    }
  },
  overheat: {
    severity: "urgent",
    en: {
      meaning:
        "The engine or transmission is overheating, or the cooling system is not working properly. Overheating can destroy the engine within minutes.",
      causes: [
        "Low coolant or a leak",
        "Stuck thermostat",
        "Failed water pump or cooling fan",
        "Clogged radiator",
        "Low transmission fluid"
      ],
      todo: "Stop in a safe place and switch off the engine. Do not open the hot cap. Wait until it cools, check the level and call a service if you cannot find the cause.",
      drive: "Do not keep driving while the temperature is high. Stop and let it cool."
    },
    ru: {
      meaning:
        "Двигатель или коробка передач перегреваются либо система охлаждения работает неправильно. Перегрев может убить двигатель за несколько минут.",
      causes: [
        "Низкий уровень охлаждающей жидкости или течь",
        "Заклинивший термостат",
        "Неисправные помпа или вентилятор",
        "Забитый радиатор",
        "Низкий уровень жидкости в коробке"
      ],
      todo: "Остановитесь в безопасном месте и заглушите двигатель. Не открывайте горячую крышку. Дождитесь остывания, проверьте уровень и вызовите эвакуатор или сервис, если причину найти не удалось.",
      drive: "Не продолжайте движение при высокой температуре. Остановитесь и дайте остыть."
    }
  },
  ac: {
    severity: "info",
    en: {
      meaning:
        "The air conditioning refrigerant pressure sensor or charge is out of range. The A/C may cool poorly or switch off.",
      causes: ["Low refrigerant from a leak", "Failing pressure sensor", "Wiring fault"],
      todo: "Have the A/C system checked for leaks and pressure.",
      drive: "You can drive normally; only the air conditioning is affected."
    },
    ru: {
      meaning:
        "Датчик давления хладагента кондиционера или его заправка вне нормы. Кондиционер может плохо охлаждать или отключаться.",
      causes: ["Недостаток хладагента из-за утечки", "Неисправный датчик давления", "Неисправность проводки"],
      todo: "Проверьте систему кондиционера на утечки и давление.",
      drive: "Ехать можно в обычном режиме, страдает только кондиционер."
    }
  },
  brakeSwitch: {
    severity: "watch",
    en: {
      meaning: "The brake pedal switch signal is faulty. Brake lights, cruise control and starting may be affected.",
      causes: ["Misadjusted or failing brake switch", "Wiring fault", "Blown brake light fuse"],
      todo: "Check that the brake lights work properly and have the switch adjusted or replaced.",
      drive: "Check that the brake lights work before driving."
    },
    ru: {
      meaning: "Сигнал выключателя педали тормоза неисправен. Могут пострадать стоп-сигналы, круиз-контроль и запуск.",
      causes: [
        "Разрегулированный или неисправный выключатель стоп-сигнала",
        "Неисправность проводки",
        "Перегоревший предохранитель стоп-сигналов"
      ],
      todo: "Проверьте, работают ли стоп-сигналы, и отрегулируйте или замените выключатель.",
      drive: "Перед поездкой убедитесь, что стоп-сигналы горят."
    }
  },
  transGeneral: {
    severity: "soon",
    en: {
      meaning:
        "The automatic transmission control system reports a fault in a sensor, solenoid, clutch or the gear ratio. Shifting may be harsh, delayed or stuck in one gear.",
      causes: [
        "Low or worn transmission fluid",
        "Failing solenoid or sensor",
        "Worn clutches inside the gearbox",
        "Wiring or connector fault"
      ],
      todo: "Check the transmission fluid level and condition and have the gearbox scanned by a specialist. Avoid hard driving and towing.",
      drive: "Drive gently to a service. If the car stays in one gear or slips, stop and call for help."
    },
    ru: {
      meaning:
        "Система управления автоматической коробкой передач сообщает о неисправности датчика, соленоида, фрикциона или передаточного числа. Переключения могут быть резкими, запаздывать или коробка может застревать на одной передаче.",
      causes: [
        "Низкий уровень или изношенная жидкость АКПП",
        "Неисправный соленоид или датчик",
        "Износ фрикционов внутри коробки",
        "Неисправность проводки или разъёма"
      ],
      todo: "Проверьте уровень и состояние жидкости АКПП и покажите коробку специалисту для диагностики. Избегайте резкой езды и буксировки.",
      drive:
        "Езжайте плавно до сервиса. Если машина застревает на одной передаче или буксует, остановитесь и вызовите помощь."
    }
  },
  turbo: {
    severity: "soon",
    en: {
      meaning:
        "The turbocharger boost pressure is too high or too low, or its sensor or control has a fault. Power may drop or the car may enter limp mode.",
      causes: [
        "Boost leak from a cracked hose or intercooler",
        "Stuck wastegate or boost control valve",
        "Failing turbocharger",
        "Faulty boost pressure sensor"
      ],
      todo: "Check the intake hoses, clamps and intercooler for leaks and have the boost control tested.",
      drive: "Drive gently. Heavy loads on a faulty turbo can cause damage."
    },
    ru: {
      meaning:
        "Давление наддува турбины слишком высокое или низкое, либо его датчик или управление неисправны. Мощность может упасть, возможен аварийный режим.",
      causes: [
        "Утечка наддува из-за треснувшего патрубка или интеркулера",
        "Залипший вестгейт или клапан управления наддувом",
        "Неисправная турбина",
        "Неисправный датчик давления наддува"
      ],
      todo: "Проверьте патрубки, хомуты и интеркулер на утечки и проверьте управление наддувом.",
      drive: "Езжайте плавно. Большая нагрузка на неисправную турбину может её повредить."
    }
  },
  dpf: {
    severity: "soon",
    en: {
      meaning: "The diesel particulate filter is clogged, not regenerating well, or its sensor has a fault.",
      causes: [
        "Many short trips so the filter cannot burn off soot",
        "Failing differential pressure sensor",
        "Failed regeneration",
        "Fuel or oil dilution"
      ],
      todo: "Take a longer drive at steady higher speed (about 20 minutes) so the filter can regenerate; if the code stays, have it checked or forced to regenerate at a service.",
      drive: "You can drive, but a heavily clogged filter reduces power and can be costly. Do not delay."
    },
    ru: {
      meaning: "Сажевый фильтр дизеля забит, плохо регенерируется или его датчик неисправен.",
      causes: [
        "Частые короткие поездки, фильтр не успевает выжигать сажу",
        "Неисправный датчик перепада давления",
        "Неудачная регенерация",
        "Разжижение масла топливом"
      ],
      todo: "Проедьтесь подольше на стабильно высокой скорости (около 20 минут), чтобы фильтр мог регенерироваться; если ошибка остаётся, проверьте или запустите принудительную регенерацию в сервисе.",
      drive: "Ехать можно, но сильно забитый фильтр снижает мощность, ремонт может быть дорогим. Не откладывайте."
    }
  },
  intake: {
    severity: "watch",
    en: {
      meaning: "The intake air system has a leak or an intake manifold flap or runner control fault.",
      causes: ["Cracked intake hose or loose clamp", "Stuck intake manifold flap", "Faulty actuator or wiring"],
      todo: "Inspect intake hoses and clamps, then have the flap actuator checked.",
      drive: DRIVE_OK_EN
    },
    ru: {
      meaning:
        "В системе впуска воздуха есть утечка либо неисправна заслонка или управление длиной впускного коллектора.",
      causes: [
        "Треснувший патрубок впуска или ослабший хомут",
        "Заклинившая заслонка коллектора",
        "Неисправный привод или проводка"
      ],
      todo: "Осмотрите патрубки и хомуты впуска, затем проверьте привод заслонок.",
      drive: DRIVE_OK_RU
    }
  },
  netBus: {
    severity: "watch",
    en: {
      meaning:
        "A communication bus (CAN) between control modules is faulty or switched off. Several warning lights may be on.",
      causes: [
        "Low battery voltage",
        "Damaged CAN wiring or connector",
        "A faulty control module disturbing the bus",
        "Water ingress in a connector"
      ],
      todo: "Check the battery and ground first. Then have the network checked by a specialist with a scanner.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning:
        "Шина связи (CAN) между блоками управления неисправна или отключена. Могут гореть сразу несколько индикаторов.",
      causes: [
        "Низкое напряжение аккумулятора",
        "Повреждённая проводка или разъём CAN",
        "Неисправный блок управления, мешающий шине",
        "Влага в разъёме"
      ],
      todo: "Сначала проверьте аккумулятор и массу. Затем покажите сеть специалисту со сканером.",
      drive: DRIVE_CARE_RU
    }
  },
  netModule: {
    severity: "watch",
    en: {
      meaning: "A control module is not answering on the communication network, so other modules lost contact with it.",
      causes: [
        "Low battery voltage or a recent battery disconnect",
        "Blown fuse or no power to the module",
        "Wiring or connector fault",
        "Failed module"
      ],
      todo: "Check the battery and the fuses of that module first. If the code stays, have the module and the wiring to it tested.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning: "Блок управления не отвечает в сети, поэтому другие блоки потеряли с ним связь.",
      causes: [
        "Низкое напряжение аккумулятора или недавнее отключение аккумулятора",
        "Перегоревший предохранитель или нет питания блока",
        "Неисправность проводки или разъёма",
        "Вышел из строя сам блок"
      ],
      todo: "Сначала проверьте аккумулятор и предохранители этого блока. Если ошибка остаётся, проверьте блок и проводку к нему.",
      drive: DRIVE_CARE_RU
    }
  },
  netInvalid: {
    severity: "watch",
    en: {
      meaning: "A control module received an invalid or implausible message from another module.",
      causes: [
        "Fault in the sending module or its sensors",
        "Low battery voltage",
        "Network wiring fault",
        "Software mismatch after repair"
      ],
      todo: "Look for other codes from the module that sends the data and fix those first.",
      drive: DRIVE_CARE_EN
    },
    ru: {
      meaning: "Блок управления получил от другого блока недопустимое или неправдоподобное сообщение.",
      causes: [
        "Неисправность передающего блока или его датчиков",
        "Низкое напряжение аккумулятора",
        "Неисправность проводки сети",
        "Несовпадение программного обеспечения после ремонта"
      ],
      todo: "Найдите другие ошибки у блока, который передаёт данные, и устраните их в первую очередь.",
      drive: DRIVE_CARE_RU
    }
  }
} as const satisfies Record<string, Group>

export type GroupId = keyof typeof GROUPS
