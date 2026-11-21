import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { make, retryLanguage, toBase64, WHISPER_MODEL, SpeechFailed } from "../src/speech.ts"

describe("Speech", () => {
  it.effect("sends base64 audio to whisper and trims the text", () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = []
    const speech = make({
      run: async (model, input) => {
        calls.push({ model, input })
        return { text: "  привет \n мир " }
      }
    })
    return Effect.gen(function* () {
      const out = yield* speech.transcribe(new Uint8Array([1, 2, 3]))
      expect(out.text).toBe("привет мир")
      expect(calls[0]?.model).toBe(WHISPER_MODEL)
      expect(calls[0]?.input).toEqual({ audio: toBase64(new Uint8Array([1, 2, 3])) })
      expect(toBase64(new Uint8Array([1, 2, 3]))).toBe("AQID")
    })
  })

  it.effect("retries in Russian when whisper detects a Slavic language by mistake", () => {
    const inputs: Array<Record<string, unknown>> = []
    const speech = make({
      run: async (_model, input) => {
        inputs.push(input)
        return input.language === undefined
          ? { text: "Jak dělá u tebě?", transcription_info: { language: "cs" } }
          : { text: "Как дела у тебя?", transcription_info: { language: "ru" } }
      }
    })
    return Effect.gen(function* () {
      const out = yield* speech.transcribe(new Uint8Array([1]), "en")
      expect(out.text).toBe("Как дела у тебя?")
      expect(inputs.map((i) => i.language)).toEqual([undefined, "ru"])
    })
  })

  it("decides when to retry and in which language", () => {
    expect(retryLanguage("ru", "en")).toBeUndefined()
    expect(retryLanguage("en", "ru")).toBeUndefined()
    expect(retryLanguage(undefined, "ru")).toBeUndefined()
    expect(retryLanguage("pl", "en")).toBe("ru")
    expect(retryLanguage("de", "en")).toBe("en")
  })

  it.effect("maps a thrown binding error to SpeechFailed", () =>
    Effect.gen(function* () {
      const speech = make({
        run: async () => {
          throw new Error("boom")
        }
      })
      const e = yield* Effect.flip(speech.transcribe(new Uint8Array([1])))
      expect(e).toBeInstanceOf(SpeechFailed)
    })
  )

  it.effect("maps malformed output to SpeechFailed", () =>
    Effect.gen(function* () {
      const speech = make({ run: async () => ({ nope: 1 }) })
      const e = yield* Effect.flip(speech.transcribe(new Uint8Array([1])))
      expect(e._tag).toBe("SpeechFailed")
    })
  )

  it.effect("encodes large buffers", () =>
    Effect.sync(() => {
      const big = new Uint8Array(100_000).fill(65)
      expect(atob(toBase64(big)).length).toBe(100_000)
    })
  )
})
