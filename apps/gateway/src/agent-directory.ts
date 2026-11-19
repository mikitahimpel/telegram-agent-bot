import { Effect, Layer } from "effect"
import { AgentDirectory, type AgentInfo } from "@bot/core-contracts/agent-directory"
import { Allowlist } from "@bot/core-contracts/allowlist"
import { ContainerDown, StorageError } from "@bot/core-contracts/errors"
import { TgId } from "@bot/core-contracts/ids"
import type { Env } from "./env.ts"

const viaStub = <A>(operation: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new ContainerDown({ reason: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`, cause })
  })

/** Admin operations on other accounts through their user-agent DO stubs. */
export const agentDirectoryLayer = (env: Env): Layer.Layer<AgentDirectory, never, Allowlist> =>
  Layer.effect(
    AgentDirectory,
    Effect.gen(function* () {
      const allowlist = yield* Allowlist
      const stub = (tgId: number) => env.USER_AGENT.getByName(String(tgId))

      const info = (tgId: TgId): Effect.Effect<AgentInfo, StorageError | ContainerDown> =>
        viaStub("info", () => stub(tgId).info(tgId)).pipe(
          Effect.map((dto) => ({ ...dto, tgId: TgId.make(dto.tgId) }))
        )

      return {
        info: (tgId) =>
          Effect.gen(function* () {
            const base = yield* info(tgId)
            const entry = (yield* allowlist.list).find((e) => e.tgId === tgId)
            return {
              ...base,
              ...(entry?.name === undefined ? {} : { name: entry.name }),
              ...(entry?.username === undefined ? {} : { username: entry.username })
            }
          }),
        list: Effect.gen(function* () {
          const entries = yield* allowlist.list
          const ids = [...new Set([allowlist.adminId, ...entries.map((e) => e.tgId)])]
          const infos = yield* Effect.forEach(ids, info, { concurrency: 5 })
          return infos.map((a): AgentInfo => {
            const entry = entries.find((e) => e.tgId === a.tgId)
            return {
              ...a,
              ...(entry?.name === undefined ? {} : { name: entry.name }),
              ...(entry?.username === undefined ? {} : { username: entry.username })
            }
          })
        }),
        kill: (tgId) => viaStub("kill", () => stub(tgId).kill(tgId)),
        restart: (tgId) => viaStub("restart", () => stub(tgId).restart(tgId))
      }
    })
  )
