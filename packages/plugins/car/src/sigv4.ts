const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")

const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return crypto.subtle.sign("HMAC", k, encoder.encode(data))
}

const sha256Hex = async (data: string): Promise<string> => hex(await crypto.subtle.digest("SHA-256", encoder.encode(data)))

/** RFC 3986 percent-encoding as required by SigV4. */
const encode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export interface PresignInput {
  readonly method: "GET" | "PUT"
  readonly host: string
  /** Absolute path starting with "/", NOT yet encoded (e.g. "/bucket/car/1/x.bin"). */
  readonly path: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** "auto" for R2. */
  readonly region: string
  readonly service: string
  readonly expiresSeconds: number
  readonly now: Date
}

/** AWS SigV4 query-string signing (presigned URL), payload UNSIGNED-PAYLOAD. */
export const presignUrl = async (input: PresignInput): Promise<string> => {
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const date = amzDate.slice(0, 8)
  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const params: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(input.expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"]
  ]
  const canonicalQuery = params
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const canonicalPath = input.path.split("/").map(encode).join("/")
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    `host:${input.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n")
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n")
  const kDate = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), date)
  const kRegion = await hmac(kDate, input.region)
  const kService = await hmac(kRegion, input.service)
  const kSigning = await hmac(kService, "aws4_request")
  const signature = hex(await hmac(kSigning, stringToSign))
  return `https://${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
