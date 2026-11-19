import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { adapterMemoryBrowserLayer } from "./adapter-memory.ts"
import * as AutoModule from "./auto.ts"
import { connectorBrowserLayer } from "./connector.ts"
import * as CarApiModule from "./api-client.ts"
import type { Credential } from "./api-client.ts"
import { geoBrowserLayer, lifecycleBrowserLayer, wakeLockBrowserLayer } from "./platform.ts"
import * as RecorderModule from "./recorder.ts"
import * as SyncModule from "./sync.ts"
import { layerIndexedDb } from "./store.ts"

export type CarRuntimeOptions = {
  readonly apiBase: string
  readonly credential?: Credential | undefined
  readonly dbName?: string
}

export const makeCarRuntime = (options: CarRuntimeOptions) => {
  const store = layerIndexedDb(options.dbName ?? "car-recorder")
  const platform = Layer.mergeAll(geoBrowserLayer, wakeLockBrowserLayer, lifecycleBrowserLayer, adapterMemoryBrowserLayer, connectorBrowserLayer)
  const api = CarApiModule.layer({ apiBase: options.apiBase, credential: options.credential }).pipe(
    Layer.provide(FetchHttpClient.layer)
  )
  const base = Layer.mergeAll(store, api, platform)
  const recorder = RecorderModule.layer.pipe(Layer.provide(base))
  const sync = SyncModule.layer.pipe(Layer.provide(base))
  const auto = AutoModule.layer.pipe(Layer.provide(Layer.mergeAll(base, recorder, sync)))
  return ManagedRuntime.make(Layer.mergeAll(base, recorder, sync, auto))
}
