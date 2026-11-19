import { Effect } from "effect"
import type { Attachment } from "@bot/core-contracts/agent-runner"
import { defineMessages, type Lang } from "@bot/core-contracts/lang"
import type { TelegramError } from "@bot/core-contracts/errors"
import { MAX_DOWNLOAD_BYTES, Telegram, type SendTarget } from "@bot/core-contracts/telegram"
import { Speech } from "@bot/infra-speech/speech"
import type { Message, PhotoSize } from "@bot/telegram-schema/schema"

export const ingestMessages = defineMessages({
  en: {
    tooBig: "That file is too big for me: Telegram lets bots download files up to 20 MB. Send a smaller one.",
    notHeard: "I couldn't make out the voice message. Try again or write it as text.",
    defaultFilePrompt: "The user sent a file: figure out what it is and briefly tell them about it."
  },
  ru: {
    tooBig: "Этот файл слишком большой: Telegram разрешает ботам скачивать файлы до 20 МБ. Пришлите файл поменьше.",
    notHeard: "Не расслышал, попробуйте ещё раз или напишите текстом.",
    defaultFilePrompt: "Пользователь прислал файл: разберись, что это, и кратко расскажи."
  }
})

export type IngestedInput = {
  readonly prompt: string
  readonly attachments: ReadonlyArray<Attachment>
  readonly heard: string | undefined
}

export type Media =
  | { readonly kind: "audio"; readonly fileId: string; readonly fileSize: number | undefined }
  | {
      readonly kind: "file"
      readonly fileId: string
      readonly fileSize: number | undefined
      readonly fileName: string
      readonly mimeType: string
    }

export const largestPhoto = (sizes: ReadonlyArray<PhotoSize>): PhotoSize | undefined =>
  sizes.reduce<PhotoSize | undefined>((best, p) => {
    if (best === undefined) return p
    const score = (x: PhotoSize) => x.file_size ?? x.width * x.height
    return score(p) > score(best) ? p : best
  }, undefined)

export const mediaOf = (message: Message): ReadonlyArray<Media> => {
  const out: Array<Media> = []
  if (message.voice !== undefined)
    out.push({ kind: "audio", fileId: message.voice.file_id, fileSize: message.voice.file_size })
  if (message.audio !== undefined)
    out.push({ kind: "audio", fileId: message.audio.file_id, fileSize: message.audio.file_size })
  if (message.video_note !== undefined) {
    out.push({ kind: "audio", fileId: message.video_note.file_id, fileSize: message.video_note.file_size })
  }
  const photo = message.photo === undefined ? undefined : largestPhoto(message.photo)
  if (photo !== undefined) {
    out.push({
      kind: "file",
      fileId: photo.file_id,
      fileSize: photo.file_size,
      fileName: `photo-${photo.file_unique_id}.jpg`,
      mimeType: "image/jpeg"
    })
  }
  if (message.document !== undefined) {
    const d = message.document
    out.push({
      kind: "file",
      fileId: d.file_id,
      fileSize: d.file_size,
      fileName: d.file_name ?? `file-${d.file_unique_id}`,
      mimeType: d.mime_type ?? "application/octet-stream"
    })
  }
  return out
}

export const hasMedia = (message: Message): boolean => mediaOf(message).length > 0

export const truncateQuote = (text: string, max = 300): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

export const quoteOf = (heard: string): string => `🎙 «${truncateQuote(heard)}»`

const download = (media: Media) =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    if (media.fileSize !== undefined && media.fileSize > MAX_DOWNLOAD_BYTES) return undefined
    const info = yield* tg.getFile(media.fileId)
    if (info.fileSize !== undefined && info.fileSize > MAX_DOWNLOAD_BYTES) return undefined
    return yield* tg.downloadFile(info.filePath)
  })

export const ingest = (
  parts: ReadonlyArray<Message>,
  lang: Lang,
  to: SendTarget
): Effect.Effect<IngestedInput | undefined, TelegramError, Telegram | Speech> =>
  Effect.gen(function* () {
    const tg = yield* Telegram
    const m = ingestMessages[lang]
    const attachments: Array<Attachment> = []
    const heard: Array<string> = []
    for (const part of parts) {
      for (const media of mediaOf(part)) {
        const bytes = yield* download(media)
        if (bytes === undefined) {
          yield* tg.sendMessage(to, m.tooBig)
          return undefined
        }
        if (media.kind === "audio") {
          const speech = yield* Speech
          const result = yield* Effect.result(speech.transcribe(bytes))
          const text = result._tag === "Success" ? result.success.text : ""
          if (text === "") {
            yield* tg.sendMessage(to, m.notHeard)
            return undefined
          }
          heard.push(text)
        } else {
          attachments.push({ fileName: media.fileName, mimeType: media.mimeType, bytes })
        }
      }
    }
    const caption = parts.map((p) => p.caption?.trim() ?? "").find((c) => c !== "")
    const spoken = heard.join(" ")
    const prompt =
      spoken !== "" ? (caption === undefined ? spoken : `${spoken}\n\n${caption}`) : (caption ?? m.defaultFilePrompt)
    return { prompt, attachments, heard: spoken === "" ? undefined : spoken }
  })
