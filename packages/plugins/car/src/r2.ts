import { Context } from "effect"

export type R2ObjectLike = {
  readonly key: string
  readonly size: number
  readonly uploaded: Date
  readonly customMetadata?: Record<string, string> | undefined
}

export type R2ObjectBodyLike = {
  readonly arrayBuffer: () => Promise<ArrayBuffer>
} & R2ObjectLike

export type R2ListResultLike = {
  readonly objects: ReadonlyArray<R2ObjectLike>
  readonly truncated: boolean
  readonly cursor?: string | undefined
  readonly delimitedPrefixes?: ReadonlyArray<string> | undefined
}

export type R2Like = {
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
    readonly delimiter?: string
    readonly include?: ReadonlyArray<"customMetadata" | "httpMetadata">
  }) => Promise<R2ListResultLike>
  readonly head: (key: string) => Promise<R2ObjectLike | null>
  readonly delete: (keys: string | ReadonlyArray<string>) => Promise<void>
}

export class CarBucket extends Context.Service<CarBucket, R2Like>()("@bot/plugins-car/CarBucket") {}
