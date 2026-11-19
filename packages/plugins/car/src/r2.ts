import { Context } from "effect"

export interface R2ObjectLike {
  readonly key: string
  readonly size: number
  readonly uploaded: Date
  readonly customMetadata?: Record<string, string> | undefined
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  readonly arrayBuffer: () => Promise<ArrayBuffer>
}

export interface R2ListResultLike {
  readonly objects: ReadonlyArray<R2ObjectLike>
  readonly truncated: boolean
  readonly cursor?: string | undefined
}

/** Minimal structural type of a Cloudflare R2 bucket binding. */
export interface R2Like {
  readonly get: (key: string) => Promise<R2ObjectBodyLike | null>
  readonly put: (
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: { readonly customMetadata?: Record<string, string> }
  ) => Promise<R2ObjectLike | null>
  readonly list: (options?: {
    readonly prefix?: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<R2ListResultLike>
  readonly head: (key: string) => Promise<R2ObjectLike | null>
  readonly delete: (keys: string | ReadonlyArray<string>) => Promise<void>
}

/** The bucket holding `car/<tgId>/...`. Provided by the gateway from the R2 binding. */
export class CarBucket extends Context.Service<CarBucket, R2Like>()("@bot/plugins-car/CarBucket") {}
