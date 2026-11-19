import { Data } from "effect"
import type { ClaudeSessionId } from "./ids.ts"

export type AgentEvent = Data.TaggedEnum<{
  SessionStarted: { readonly sessionId: ClaudeSessionId; readonly model: string }
  TextDelta: { readonly text: string }
  AssistantText: { readonly text: string }
  ToolCall: { readonly name: string; readonly summary: string }
  FileProduced: { readonly path: string; readonly fileName: string }
  Completed: {
    readonly sessionId: ClaudeSessionId
    readonly text: string
    readonly isError: boolean
    readonly costUsd: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly durationMs: number
    readonly numTurns: number
  }
}>

export const AgentEvent = Data.taggedEnum<AgentEvent>()
