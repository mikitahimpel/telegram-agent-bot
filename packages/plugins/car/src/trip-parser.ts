import { Context, Data, Effect, Layer } from "effect"
import { defineMessages } from "@bot/core-contracts/lang"
import type { Localized } from "@bot/core-contracts/lang"

const messages = defineMessages({
  en: {
    unknown:
      "The car data file format is not defined yet, so detailed metrics are unavailable. Only file metadata (name, size, upload time) can be used."
  },
  ru: {
    unknown:
      "Формат файлов с данными машины ещё не определён, поэтому подробные метрики недоступны. Доступны только метаданные файлов (имя, размер, время загрузки)."
  }
})

/** The trip file format has not been specified; parsing is impossible. */
export class CarFormatUnknown extends Data.TaggedError("CarFormatUnknown")<{
  readonly message: string
  readonly localized: Localized
}> {}

export const carFormatUnknown = (): CarFormatUnknown =>
  new CarFormatUnknown({
    message: messages.en.unknown,
    localized: { en: messages.en.unknown, ru: messages.ru.unknown }
  })

export interface TripFile {
  readonly key: string
  readonly bytes: Uint8Array
}

/** Neutral parse result: named numeric metrics of one trip. The concrete set depends on the (future) format. */
export interface ParsedTrip {
  readonly key: string
  readonly metrics: Readonly<Record<string, number>>
}

/** Swappable parse step. Replace `layerUnknownFormat` once the file format is known. */
export class TripParser extends Context.Service<
  TripParser,
  {
    /** False while the format is unknown. */
    readonly known: boolean
    readonly parse: (file: TripFile) => Effect.Effect<ParsedTrip, CarFormatUnknown>
  }
>()("@bot/plugins-car/TripParser") {}

export const layerUnknownFormat: Layer.Layer<TripParser> = Layer.succeed(TripParser, {
  known: false,
  parse: () => Effect.fail(carFormatUnknown())
})
