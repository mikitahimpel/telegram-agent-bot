import type { Attachment } from "@bot/core-contracts/agent-runner"
import type { SessionKey } from "@bot/core-contracts/ids"

export const QUEUE_CAP = 5

export type PromptMedia = {
  readonly attachments: ReadonlyArray<Attachment>
  readonly heard: string | undefined
}

export type QueuedPrompt = {
  readonly prompt: string
  readonly media?: PromptMedia | undefined
}

export type PromptQueue = {
  readonly push: (key: SessionKey, item: QueuedPrompt) => "queued" | "full"
  readonly drain: (key: SessionKey) => ReadonlyArray<QueuedPrompt>
  readonly clear: (key: SessionKey) => void
  readonly size: (key: SessionKey) => number
}

export const makePromptQueue = (cap: number = QUEUE_CAP): PromptQueue => {
  const queues = new Map<SessionKey, Array<QueuedPrompt>>()
  return {
    push: (key, item) => {
      const list = queues.get(key) ?? []
      if (list.length >= cap) return "full"
      list.push(item)
      queues.set(key, list)
      return "queued"
    },
    drain: (key) => {
      const list = queues.get(key) ?? []
      queues.delete(key)
      return list
    },
    clear: (key) => void queues.delete(key),
    size: (key) => queues.get(key)?.length ?? 0
  }
}

export const mergePrompts = (items: ReadonlyArray<QueuedPrompt>): QueuedPrompt => {
  const [only] = items
  if (items.length === 1 && only !== undefined) return only
  const attachments = items.flatMap((i) => i.media?.attachments ?? [])
  return {
    prompt: items.map((i) => i.prompt).join("\n\n"),
    ...(attachments.length === 0 ? {} : { media: { attachments, heard: undefined } })
  }
}
