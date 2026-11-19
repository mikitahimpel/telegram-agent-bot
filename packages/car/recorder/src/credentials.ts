import { Effect } from "effect"
import { classifyStorageError, type StorageFailure } from "./errors.ts"

/** Chrome PWA device credential, stored in IndexedDB after pairing. */
export interface DeviceCredentials {
  readonly deviceToken: string
  readonly deviceId: string
  readonly tgId: number
  readonly firstName?: string
}

export interface CredentialsOptions {
  readonly dbName?: string
  readonly factory?: IDBFactory
}

const KEY = "device"
const STORE = "kv"

const withDb = <A>(opts: CredentialsOptions | undefined, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<A>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<A>((resolve, reject) => {
        const factory = opts?.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
        if (factory === undefined) {
          reject(Object.assign(new Error("IndexedDB is not available"), { name: "InvalidStateError" }))
          return
        }
        const open = factory.open(opts?.dbName ?? "car-credentials", 1)
        open.onupgradeneeded = () => void open.result.createObjectStore(STORE)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(STORE, mode)
          const req = f(tx.objectStore(STORE))
          tx.oncomplete = () => {
            db.close()
            resolve(req.result)
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error ?? new Error("aborted"))
          }
        }
      }),
    catch: classifyStorageError
  })

export const loadCredentials = (opts?: CredentialsOptions): Effect.Effect<DeviceCredentials | undefined, StorageFailure> =>
  withDb(opts, "readonly", (s) => s.get(KEY) as IDBRequest<DeviceCredentials | undefined>)

export const saveCredentials = (creds: DeviceCredentials, opts?: CredentialsOptions): Effect.Effect<void, StorageFailure> =>
  withDb(opts, "readwrite", (s) => s.put(creds, KEY)).pipe(Effect.asVoid)

export const clearCredentials = (opts?: CredentialsOptions): Effect.Effect<void, StorageFailure> =>
  withDb(opts, "readwrite", (s) => s.delete(KEY)).pipe(Effect.asVoid)
