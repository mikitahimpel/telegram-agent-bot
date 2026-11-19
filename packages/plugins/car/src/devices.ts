import { Clock, Effect } from "effect"
import { sha256Hex } from "@bot/car-format/checksum"
import { StorageError } from "@bot/core-contracts/errors"
import type { Lang } from "@bot/core-contracts/lang"
import { CarKv, type CarKvLike } from "./kv.ts"

export const PAIR_TTL_SECONDS = 30 * 60
export const LAST_SEEN_INTERVAL_MS = 10 * 60 * 1000
export const MAX_DEVICES = 10

export type DeviceRecord = {
  readonly tgId: number
  readonly deviceId: string
  readonly name: string
  readonly firstName: string
  readonly lang: Lang
  readonly createdAt: number
  readonly lastSeenAt: number | null
}

type PairRecord = {
  readonly tgId: number
  readonly firstName: string
  readonly lang: Lang
  readonly expiresAt: number
}

type IndexEntry = {
  readonly deviceId: string
  readonly hash: string
}

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("")

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

const kvError = (operation: string) => (cause: unknown) => new StorageError({ operation, cause })

const pairKey = (codeHash: string) => `carpair:${codeHash}`
const devKey = (tokenHash: string) => `cardev:${tokenHash}`
const idxKey = (tgId: number) => `cardevidx:${tgId}`

const parse = <A>(raw: string | null): A | undefined => {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as A
  } catch {
    return undefined
  }
}

const kvOp = <A>(operation: string, f: (kv: CarKvLike) => Promise<A>) =>
  Effect.gen(function* () {
    const kv = yield* CarKv
    return yield* Effect.tryPromise({ try: () => f(kv), catch: kvError(operation) })
  })

const readIndex = (tgId: number) =>
  kvOp("car.devices.index", (kv) => kv.get(idxKey(tgId))).pipe(Effect.map((raw) => parse<Array<IndexEntry>>(raw) ?? []))

const cleanName = (name: string): string => {
  const n = name
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 60)
  return n === "" ? "Chrome" : n
}

export const startPair = (who: { readonly tgId: number; readonly firstName: string; readonly lang: Lang }) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const code = randomHex(16)
    const expiresAt = now + PAIR_TTL_SECONDS * 1000
    const record: PairRecord = { ...who, expiresAt }
    const hash = yield* Effect.promise(() => sha256Hex(code))
    yield* kvOp("car.pair.put", (kv) =>
      kv.put(pairKey(hash), JSON.stringify(record), { expirationTtl: PAIR_TTL_SECONDS })
    )
    return { code, expiresAt }
  })

export type PairedDevice = {
  readonly token: string
  readonly record: DeviceRecord
}

export const completePair = (code: string, deviceName: string) =>
  Effect.gen(function* () {
    if (!/^[0-9a-f]{32}$/.test(code)) return undefined
    const now = yield* Clock.currentTimeMillis
    const codeHash = yield* Effect.promise(() => sha256Hex(code))
    const pair = parse<PairRecord>(yield* kvOp("car.pair.get", (kv) => kv.get(pairKey(codeHash))))
    if (pair === undefined) return undefined
    yield* kvOp("car.pair.delete", (kv) => kv.delete(pairKey(codeHash)))
    if (pair.expiresAt <= now) return undefined

    const token = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const tokenHash = yield* Effect.promise(() => sha256Hex(token))
    const record: DeviceRecord = {
      tgId: pair.tgId,
      deviceId: randomHex(8),
      name: cleanName(deviceName),
      firstName: pair.firstName,
      lang: pair.lang,
      createdAt: now,
      lastSeenAt: null
    }
    const index = yield* readIndex(pair.tgId)
    const keep = index.slice(-(MAX_DEVICES - 1))
    for (const old of index.slice(0, index.length - keep.length)) {
      yield* kvOp("car.devices.evict", (kv) => kv.delete(devKey(old.hash)))
    }
    yield* kvOp("car.devices.put", (kv) => kv.put(devKey(tokenHash), JSON.stringify(record)))
    yield* kvOp("car.devices.index.put", (kv) =>
      kv.put(idxKey(pair.tgId), JSON.stringify([...keep, { deviceId: record.deviceId, hash: tokenHash }]))
    )
    return { token, record } satisfies PairedDevice
  })

export const authDevice = (token: string) =>
  Effect.gen(function* () {
    if (token.length < 20 || token.length > 100) return undefined
    const hash = yield* Effect.promise(() => sha256Hex(token))
    const record = parse<DeviceRecord>(yield* kvOp("car.devices.get", (kv) => kv.get(devKey(hash))))
    if (record === undefined) return undefined
    const now = yield* Clock.currentTimeMillis
    if (record.lastSeenAt === null || now - record.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
      yield* kvOp("car.devices.touch", (kv) =>
        kv.put(devKey(hash), JSON.stringify({ ...record, lastSeenAt: now }))
      ).pipe(Effect.ignore)
    }
    return record
  })

export const listDevices = (tgId: number) =>
  Effect.gen(function* () {
    const index = yield* readIndex(tgId)
    const out: Array<DeviceRecord> = []
    for (const e of index) {
      const rec = parse<DeviceRecord>(yield* kvOp("car.devices.get", (kv) => kv.get(devKey(e.hash))))
      if (rec !== undefined && rec.tgId === tgId) out.push(rec)
    }
    return out
  })

export const revokeDevice = (tgId: number, deviceId: string) =>
  Effect.gen(function* () {
    const index = yield* readIndex(tgId)
    const entry = index.find((e) => e.deviceId === deviceId)
    if (entry === undefined) return false
    yield* kvOp("car.devices.delete", (kv) => kv.delete(devKey(entry.hash)))
    yield* kvOp("car.devices.index.put", (kv) =>
      kv.put(idxKey(tgId), JSON.stringify(index.filter((e) => e.deviceId !== deviceId)))
    )
    return true
  })

export const DEVICE_CALLBACK_PREFIX = "cardev"
export const pairUrl = (webUrl: string, code: string): string => `${webUrl}#pair=${code}`
