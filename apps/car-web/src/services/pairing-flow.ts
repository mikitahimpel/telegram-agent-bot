import type { CarBackend } from "./backend.ts"
import { completePair, credentialStore, deviceNameFromUA, parsePairHash } from "./pairing.ts"

export interface PairingEnv {
  hash: string
  ua: string
  apiBase: string
  fetchFn?: typeof fetch
  stripHash(): void
}

export const runPairing = async (backend: CarBackend, env: PairingEnv): Promise<void> => {
  const canRecord = backend.caps.ble || backend.caps.serial
  if (!canRecord) return
  const code = parsePairHash(env.hash)
  if (code) {
    backend.pairing.value = "progress"
    const r = await completePair(env.apiBase, code, deviceNameFromUA(env.ua), env.fetchFn)
    if (r.ok) {
      await credentialStore.save(r.credential)
      await backend.adoptCredential(r.credential)
      env.stripHash()
      backend.pairing.value = "paired"
      return
    }
    if (r.error !== "network") env.stripHash()
    backend.pairing.value = r.error
    return
  }
  const cred = await credentialStore.load()
  if (cred) await backend.adoptCredential(cred)
  backend.pairing.value = cred ? "paired" : "unpaired"
}
