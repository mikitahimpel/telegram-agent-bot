import type { Message } from "./schema.ts"

export interface ParsedCommand {
  readonly name: string
  readonly args: string
}

/**
 * Parses `/cmd`, `/cmd args` and `/cmd@botname args`. A command is recognized when a
 * `bot_command` entity sits at offset 0 (or, without entities, when the text starts with `/`).
 * `name` is lower-cased and has no slash or bot suffix. When `botUsername` is given,
 * commands addressed to a different bot yield `undefined`.
 */
export const parseCommand = (
  message: Pick<Message, "text" | "entities">,
  botUsername?: string
): ParsedCommand | undefined => {
  const text = message.text
  if (text === undefined) return undefined
  const entity = message.entities?.find((e) => e.type === "bot_command" && e.offset === 0)
  let token: string
  if (entity !== undefined) {
    token = text.slice(0, entity.length)
  } else {
    if (message.entities !== undefined && message.entities.length > 0 && !text.startsWith("/")) return undefined
    if (!text.startsWith("/")) return undefined
    token = text.split(/\s/, 1)[0] ?? ""
  }
  const m = /^\/([A-Za-z0-9_]{1,64})(?:@([A-Za-z0-9_]+))?$/.exec(token)
  if (m === null) return undefined
  const target = m[2]
  if (target !== undefined && botUsername !== undefined && target.toLowerCase() !== botUsername.replace(/^@/, "").toLowerCase()) {
    return undefined
  }
  return { name: m[1]!.toLowerCase(), args: text.slice(token.length).trim() }
}
