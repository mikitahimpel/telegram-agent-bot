import { ConfigProvider, Layer } from "effect"
import type { Env } from "./env.ts"

/** The car presigner reads these four keys; they are derived from the R2 S3 credentials binding. */
const r2Config = (raw: string | undefined): Record<string, string> => {
  if (raw === undefined) return {}
  try {
    const s3 = JSON.parse(raw) as { endpoint: string; bucketName: string; accessKeyId: string; secretAccessKey: string }
    const accountId = new URL(s3.endpoint).hostname.split(".")[0] ?? ""
    return {
      R2_ACCOUNT_ID: accountId,
      R2_ACCESS_KEY_ID: s3.accessKeyId,
      R2_SECRET_ACCESS_KEY: s3.secretAccessKey,
      CAR_BUCKET_NAME: s3.bucketName
    }
  } catch {
    return {}
  }
}

/** Worker bindings as a flat config source: `Config.String("X")` reads `env.X`. */
export const configRecord = (env: Env, origin?: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (typeof value === "string") out[key] = value
  // The Worker cannot reference its own URL in its bindings, so an empty CAR_WEB_URL falls back to the request origin.
  if (out["CAR_WEB_URL"] === "") delete out["CAR_WEB_URL"]
  if (out["CAR_WEB_URL"] === undefined && origin !== undefined && origin !== "") out["CAR_WEB_URL"] = `${origin}/car/`
  return { ...out, ...r2Config(env.R2_S3) }
}

export const configLayer = (env: Env, origin?: string): Layer.Layer<never> =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(configRecord(env, origin)))
