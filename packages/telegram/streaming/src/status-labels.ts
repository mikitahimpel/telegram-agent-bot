import type { Lang } from "@bot/core-contracts/lang"
import { statusLabels } from "./messages.ts"

export type StatusKind = "search" | "fetch" | "readFile" | "writeFile" | "compute" | "car" | "reminder" | "thinking"

const CAR_TOOL = /^mcp__.+__car_/
const REMINDER_TOOL = /(remind|schedule|alarm)/i

const BASE: Readonly<Record<string, StatusKind>> = {
  WebSearch: "search",
  WebFetch: "fetch",
  Read: "readFile",
  Glob: "readFile",
  Grep: "readFile",
  NotebookRead: "readFile",
  Write: "writeFile",
  Edit: "writeFile",
  MultiEdit: "writeFile",
  NotebookEdit: "writeFile",
  Bash: "compute",
  BashOutput: "compute",
  Python: "compute"
}

export const statusKindOf = (toolName: string): StatusKind => {
  const base = BASE[toolName]
  if (base !== undefined) return base
  if (CAR_TOOL.test(toolName)) return "car"
  if (toolName.startsWith("mcp__") && REMINDER_TOOL.test(toolName)) return "reminder"
  return "thinking"
}

export const humanStatus = (toolName: string, lang: Lang): string => statusLabels[lang][statusKindOf(toolName)]
