import { Effect, Layer } from "effect"
import { StorageError } from "@bot/core-contracts/errors"
import type { TgId } from "@bot/core-contracts/ids"
import type { WriteResult } from "@bot/bot-memory/memory-store"
import { UserMemory } from "@bot/bot-memory/user-memory"
import type { Env } from "./env.ts"

const call = <A>(operation: string, f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ operation, cause }) })

export const rpcUserMemory = (env: Env): Layer.Layer<UserMemory> =>
  Layer.succeed(UserMemory, {
    forUser: (tgId: TgId) => {
      const stub = () => env.USER_AGENT.getByName(String(tgId))
      return {
        list: call("memory.rpc.list", () => stub().memoryList()),
        remember: (text: string) =>
          call("memory.rpc.remember", async () => (await stub().memoryRemember(text)) as WriteResult),
        update: (id: number, text: string) =>
          call("memory.rpc.update", async () => (await stub().memoryUpdate(id, text)) as WriteResult),
        forget: (id: number) => call("memory.rpc.forget", () => stub().memoryForget(id)),
        forgetAll: call("memory.rpc.forget-all", () => stub().memoryForgetAll()),
        render: call("memory.rpc.render", () => stub().memoryRender())
      }
    }
  })
