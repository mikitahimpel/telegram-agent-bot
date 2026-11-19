import type { Sample } from "@bot/car-format/sample"

export type ObdKey = Exclude<keyof Sample, "ts" | "lat" | "lon" | "gpsAccuracyM" | "gpsSpeedKmh">

export type PidDef = {
  readonly pid: string
  readonly key: ObdKey
  readonly label: string
  readonly bytes: number
  readonly decode: (b: ReadonlyArray<number>) => number
  readonly slow: boolean
}

const A = (b: ReadonlyArray<number>) => b[0] ?? 0
const AB = (b: ReadonlyArray<number>) => (b[0] ?? 0) * 256 + (b[1] ?? 0)

export const PIDS: ReadonlyArray<PidDef> = [
  { pid: "0C", key: "rpm", label: "Engine RPM", bytes: 2, decode: (b) => AB(b) / 4, slow: false },
  { pid: "0D", key: "speedKmh", label: "Vehicle speed", bytes: 1, decode: A, slow: false },
  { pid: "04", key: "loadPct", label: "Engine load", bytes: 1, decode: (b) => (A(b) * 100) / 255, slow: false },
  { pid: "11", key: "throttlePct", label: "Throttle position", bytes: 1, decode: (b) => (A(b) * 100) / 255, slow: false },
  { pid: "10", key: "mafGps", label: "MAF", bytes: 2, decode: (b) => AB(b) / 100, slow: false },
  { pid: "0B", key: "mapKpa", label: "Intake manifold pressure", bytes: 1, decode: A, slow: false },
  { pid: "5E", key: "fuelRateLph", label: "Fuel rate", bytes: 2, decode: (b) => AB(b) / 20, slow: false },
  { pid: "05", key: "coolantC", label: "Coolant temperature", bytes: 1, decode: (b) => A(b) - 40, slow: true },
  { pid: "0F", key: "intakeC", label: "Intake air temperature", bytes: 1, decode: (b) => A(b) - 40, slow: true },
  { pid: "2F", key: "fuelLevelPct", label: "Fuel level", bytes: 1, decode: (b) => (A(b) * 100) / 255, slow: true },
  { pid: "42", key: "voltageV", label: "Control module voltage", bytes: 2, decode: (b) => AB(b) / 1000, slow: true }
]

export const pidByCode = (pid: string): PidDef | undefined => PIDS.find((p) => p.pid === pid.toUpperCase())

export const parseSupportedMask = (base: number, bytes: ReadonlyArray<number>): string[] => {
  const out: string[] = []
  for (let i = 0; i < 32; i++) {
    const byte = bytes[i >> 3] ?? 0
    if ((byte & (0x80 >> (i & 7))) !== 0) out.push((base + i + 1).toString(16).toUpperCase().padStart(2, "0"))
  }
  return out
}

const GASOLINE_AFR = 14.7
const GASOLINE_DENSITY_KG_PER_L = 0.745

export const fuelLphFromMaf = (mafGps: number): number =>
  (mafGps / GASOLINE_AFR / 1000 / GASOLINE_DENSITY_KG_PER_L) * 3600

export type FuelRateSource = "pid_5e" | "maf_estimate" | "none"

export const fuelRateSourceFor = (supported: ReadonlyArray<string>): FuelRateSource =>
  supported.includes("5E") ? "pid_5e" : supported.includes("10") ? "maf_estimate" : "none"

export const parseVoltage = (text: string): number | undefined => {
  const m = /(\d+(?:\.\d+)?)\s*V?/i.exec(text)
  return m === null ? undefined : Number(m[1])
}

const PROTOCOLS: Record<string, string> = {
  "0": "Automatic",
  "1": "SAE J1850 PWM",
  "2": "SAE J1850 VPW",
  "3": "ISO 9141-2",
  "4": "ISO 14230-4 KWP (5 baud init)",
  "5": "ISO 14230-4 KWP (fast init)",
  "6": "ISO 15765-4 CAN (11 bit, 500 kbaud)",
  "7": "ISO 15765-4 CAN (29 bit, 500 kbaud)",
  "8": "ISO 15765-4 CAN (11 bit, 250 kbaud)",
  "9": "ISO 15765-4 CAN (29 bit, 250 kbaud)",
  A: "SAE J1939 CAN",
  B: "User1 CAN",
  C: "User2 CAN"
}

export const protocolName = (dpn: string): string => {
  const code = dpn.trim().toUpperCase().replace(/^A(?=[0-9A-C]$)/, "")
  return PROTOCOLS[code] ?? dpn.trim()
}

export const isCanProtocol = (dpn: string): boolean => /^A?[6-9]$/i.test(dpn.trim())
