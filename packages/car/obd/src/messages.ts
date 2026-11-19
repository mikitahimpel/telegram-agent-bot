import { hexToBytes } from "./hex.ts"

const norm = (s: string): string => s.replace(/\s/g, "").toUpperCase()

export const groupMessages = (lines: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<number>> => {
  const out: Array<Array<number>> = []
  let multi: { expected: number; hex: string; index: number } | undefined
  const close = () => {
    if (multi !== undefined) {
      out.push(hexToBytes(multi.hex).slice(0, multi.expected))
      multi = undefined
    }
  }
  for (const raw of lines) {
    const line = norm(raw)
    if (/^[0-9A-F]{3}$/.test(line)) {
      close()
      multi = { expected: parseInt(line, 16), hex: "", index: 0 }
      continue
    }
    const frame = /^[0-9A-F]:([0-9A-F]+)$/.exec(line)
    if (frame !== null) {
      if (multi !== undefined) multi.hex += frame[1] as string
      continue
    }
    if (/^([0-9A-F]{2})+$/.test(line)) {
      close()
      out.push(hexToBytes(line))
    }
  }
  close()
  return out
}
