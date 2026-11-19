import type { R2Like, R2ObjectLike } from "./r2.ts"

export const makeMemoryR2 = (): R2Like & { readonly objects: Map<string, { bytes: Uint8Array; meta?: Record<string, string> | undefined; uploaded: Date }> } => {
  const objects = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> | undefined; uploaded: Date }>()
  const toObj = (key: string, v: { bytes: Uint8Array; meta?: Record<string, string> | undefined; uploaded: Date }): R2ObjectLike => ({
    key,
    size: v.bytes.length,
    uploaded: v.uploaded,
    customMetadata: v.meta
  })
  return {
    objects,
    get: async (key) => {
      const v = objects.get(key)
      if (v === undefined) return null
      return { ...toObj(key, v), arrayBuffer: async () => v.bytes.slice().buffer as ArrayBuffer }
    },
    put: async (key, value, options) => {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer)
      const v = { bytes, meta: options?.customMetadata, uploaded: new Date() }
      objects.set(key, v)
      return toObj(key, v)
    },
    head: async (key) => {
      const v = objects.get(key)
      return v === undefined ? null : toObj(key, v)
    },
    list: async (options) => {
      const prefix = options?.prefix ?? ""
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const res: Array<R2ObjectLike> = []
      const prefixes = new Set<string>()
      for (const k of keys) {
        const rest = k.slice(prefix.length)
        const i = options?.delimiter === undefined ? -1 : rest.indexOf(options.delimiter)
        if (i >= 0) prefixes.add(prefix + rest.slice(0, i + 1))
        else res.push(toObj(k, objects.get(k)!))
      }
      return { objects: res, truncated: false, delimitedPrefixes: [...prefixes] }
    },
    delete: async (keys) => {
      for (const k of typeof keys === "string" ? [keys] : keys) objects.delete(k)
    }
  }
}
