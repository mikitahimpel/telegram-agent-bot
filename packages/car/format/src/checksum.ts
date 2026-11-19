/** Lowercase hex SHA-256 (WebCrypto; works in browsers and Workers). */
export const sha256Hex = async (data: string | Uint8Array): Promise<string> => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
