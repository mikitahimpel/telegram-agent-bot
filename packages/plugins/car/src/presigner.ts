import { Clock, Config, Context, Effect, Layer, Redacted } from "effect"
import { presignUrl } from "./sigv4.ts"

export type PresignerConfig = {
  readonly accountId: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucketName: string
}

export const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60
export const DEFAULT_DOWNLOAD_TTL_SECONDS = 10 * 60

export class Presigner extends Context.Service<
  Presigner,
  {
    readonly presignPut: (key: string, ttlSeconds?: number) => Effect.Effect<string>
    readonly presignGet: (key: string, ttlSeconds?: number) => Effect.Effect<string>
  }
>()("@bot/plugins-car/Presigner") {}

const make = (config: PresignerConfig): Presigner["Service"] => {
  const sign = (method: "GET" | "PUT", key: string, ttl: number) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      return yield* Effect.promise(() =>
        presignUrl({
          method,
          host: `${config.accountId}.r2.cloudflarestorage.com`,
          path: `/${config.bucketName}/${key}`,
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          region: "auto",
          service: "s3",
          expiresSeconds: ttl,
          now: new Date(now)
        })
      )
    })
  return {
    presignPut: (key, ttl = DEFAULT_UPLOAD_TTL_SECONDS) => sign("PUT", key, ttl),
    presignGet: (key, ttl = DEFAULT_DOWNLOAD_TTL_SECONDS) => sign("GET", key, ttl)
  }
}

export const layerWith = (config: PresignerConfig): Layer.Layer<Presigner> => Layer.succeed(Presigner, make(config))

export const layerConfig = Layer.effect(
  Presigner,
  Effect.gen(function* () {
    const accountId = yield* Config.String("R2_ACCOUNT_ID")
    const accessKeyId = yield* Config.String("R2_ACCESS_KEY_ID")
    const secret = yield* Config.Redacted("R2_SECRET_ACCESS_KEY")
    const bucketName = yield* Config.String("CAR_BUCKET_NAME")
    return make({ accountId, accessKeyId, secretAccessKey: Redacted.value(secret), bucketName })
  })
)
