import { Effect } from "effect"
import type { CoreR } from "@bot/bot-core-commands/core-commands"
import type { JobHandler } from "@bot/core-contracts/scheduler"
import { makeDispatcher, type DocumentHook, type PresentRun } from "@bot/bot-dispatcher/dispatcher"
import { importDocument, isCsvDocument } from "@bot/plugins-car/import"
import { PluginFlags } from "@bot/plugins-registry/flags"
import { presentRun } from "@bot/telegram-streaming/streaming"
import type { PluginR } from "./plugins.ts"
import { registry } from "./registry.ts"

const present: PresentRun = ({ to, lang, stream, stopKeyboard, finalKeyboard }) =>
  presentRun(stream, to, {
    lang,
    draftId: 1 + Math.floor(Math.random() * 2_000_000_000),
    statusStyle: "human",
    stopKeyboard,
    finalKeyboard
  }).pipe(Effect.map(({ messageId, choices, keyboard }) => ({ messageId, choices, keyboard })))

const importCsvDocument: DocumentHook<CoreR | PluginR> = ({ document, tgId, chatId, threadId, lang }) =>
  Effect.gen(function* () {
    if (!isCsvDocument(document)) return false
    if (!(yield* (yield* PluginFlags).isEnabled("car", tgId))) return false
    return yield* importDocument({ tgId, chatId, threadId, lang }, document)
  })

export const { dispatch, jobs: dispatcherJobs } = makeDispatcher({
  registry,
  present,
  onDocument: importCsvDocument,
  pluginEnabled: (pluginId, tgId) => PluginFlags.use((flags) => flags.isEnabled(pluginId, tgId))
})

export type DispatchR = (typeof dispatcherJobs)[number] extends JobHandler<infer R> ? R : never
