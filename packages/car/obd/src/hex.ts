export const hexToBytes = (hex: string): number[] => {
  const out: number[] = []
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const v = parseInt(hex.slice(i, i + 2), 16)
    if (Number.isNaN(v)) break
    out.push(v)
  }
  return out
}
