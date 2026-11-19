import { Context, Data, Effect, Layer, Schema } from "effect"

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo"

export class SpeechFailed extends Data.TaggedError("SpeechFailed")<{
  readonly reason: string
}> {}

export type AiLike = {
  readonly run: (model: string, input: Record<string, unknown>) => Promise<unknown>
}

export type Transcript = { readonly text: string }

export class Speech extends Context.Service<
  Speech,
  {
    readonly transcribe: (audio: Uint8Array) => Effect.Effect<Transcript, SpeechFailed>
  }
>()("@bot/Speech") {}

const WhisperOutput = Schema.Struct({ text: Schema.String })

const CHUNK = 0x8000

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export const cleanTranscript = (text: string): string => text.replace(/\s+/g, " ").trim()

export const make = (ai: AiLike) =>
  Speech.of({
    transcribe: (audio) =>
      Effect.tryPromise({
        try: () => ai.run(WHISPER_MODEL, { audio: toBase64(audio) }),
        catch: () => new SpeechFailed({ reason: "workers ai call failed" })
      }).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(WhisperOutput)(raw).pipe(
            Effect.mapError(() => new SpeechFailed({ reason: "unexpected whisper output" }))
          )
        ),
        Effect.map((out) => ({ text: cleanTranscript(out.text) }))
      )
  })

export const layer = (ai: AiLike): Layer.Layer<Speech> => Layer.succeed(Speech, make(ai))

export const layerTest = (reply: (audio: Uint8Array) => Effect.Effect<Transcript, SpeechFailed>): Layer.Layer<Speech> =>
  Layer.succeed(Speech, Speech.of({ transcribe: reply }))
