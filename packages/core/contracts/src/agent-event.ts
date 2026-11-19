import { Data } from "effect"
import type { ClaudeSessionId } from "./ids.ts"

/**
 * Normalized events produced from the Claude Code CLI `stream-json` output.
 * The runner maps raw CLI JSON lines to these; presenters consume only these.
 */
export type AgentEvent = Data.TaggedEnum<{
  /** CLI `system/init`: the session id to store for `--resume`. */
  SessionStarted: { readonly sessionId: ClaudeSessionId; readonly model: string }
  /** Incremental assistant text (partial messages). */
  TextDelta: { readonly text: string }
  /** A complete assistant text block. */
  AssistantText: { readonly text: string }
  /** The agent called a tool. `summary` is a short human-readable description. */
  ToolCall: { readonly name: string; readonly summary: string }
  /** A file the agent produced in the sandbox and wants to send to the user. */
  FileProduced: { readonly path: string; readonly fileName: string }
  /** CLI `result` event. */
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
