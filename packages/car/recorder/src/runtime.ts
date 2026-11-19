import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import * as CarApiModule from "./api-client.ts"
import type { Credential } from "./api-client.ts"
import { geoBrowserLayer, lifecycleBrowserLayer, wakeLockBrowserLayer } from "./platform.ts"
import * as RecorderModule from "./recorder.ts"
import * as SyncModule from "./sync.ts"
import { layerIndexedDb } from "./store.ts"

export interface CarRuntimeOptions {
  /** e.g. "/car/api" or "https://host/car/api". */
  readonly apiBase: string
  /** Device credential. Without it recording works locally and sync reports NeedsReauth {not_paired}. */
  readonly credential?: Credential | undefined
  readonly dbName?: string
}

/** One runtime with TripStore, CarApi, Recorder, SyncEngine and the browser platform services. */
export const makeCarRuntime = (options: CarRuntimeOptions) => {
  const store = layerIndexedDb(options.dbName ?? "car-recorder")
  const platform = Layer.mergeAll(geoBrowserLayer, wakeLockBrowserLayer, lifecycleBrowserLayer)
  const api = CarApiModule.layer({ apiBase: options.apiBase, credential: options.credential }).pipe(
    Layer.provide(FetchHttpClient.layer)
  )
  const base = Layer.mergeAll(store, api, platform)
  const recorder = RecorderModule.layer.pipe(Layer.provide(base))
  const sync = SyncModule.layer.pipe(Layer.provide(base))
  return ManagedRuntime.make(Layer.mergeAll(base, recorder, sync))
}
