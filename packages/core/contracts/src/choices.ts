export const MIN_CHOICES = 2
export const MAX_CHOICES = 4
export const MAX_CHOICE_LENGTH = 24

const OPEN = "[[buttons:"
const COMPLETE = /[ \t]*\[\[buttons:([^\n\]]*)\]\][ \t]*$/i

export type ParsedChoices = {
  readonly text: string
  readonly choices: ReadonlyArray<string>
}

const validOptions = (raw: string): ReadonlyArray<string> | undefined => {
  const options = raw.split("|").map((o) => o.trim())
  if (options.length < MIN_CHOICES || options.length > MAX_CHOICES) return undefined
  if (options.some((o) => o === "" || o.length > MAX_CHOICE_LENGTH)) return undefined
  return options
}

export const splitChoices = (text: string): ParsedChoices => {
  const trimmed = text.trimEnd()
  const match = COMPLETE.exec(trimmed)
  if (match === null) return { text, choices: [] }
  const options = validOptions(match[1] ?? "")
  if (options === undefined) return { text, choices: [] }
  return { text: trimmed.slice(0, match.index).trimEnd(), choices: options }
}

const isOpenMarkerTail = (tail: string): boolean => {
  const lowered = tail.toLowerCase()
  const partial = lowered.length < OPEN.length && OPEN.startsWith(lowered)
  const unclosed = lowered.startsWith(OPEN) && !tail.includes("]]")
  return partial || unclosed
}

export const hideChoiceMarker = (text: string): string => {
  const parsed = splitChoices(text)
  if (parsed.choices.length > 0) return parsed.text
  const at = text.lastIndexOf("[[")
  if (at !== -1 && isOpenMarkerTail(text.slice(at))) return text.slice(0, at).trimEnd()
  if (text.endsWith("[") && !text.endsWith("[[")) return text.slice(0, -1).trimEnd()
  return text
}
