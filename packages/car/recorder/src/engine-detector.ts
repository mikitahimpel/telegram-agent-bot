export const START_RPM = 300
export const START_HOLD_MS = 3000
export const STOP_AFTER_MS = 60_000

export type EngineSignal = "none" | "started" | "stopped"

export type EngineDetectorConfig = {
  readonly startRpm?: number
  readonly startHoldMs?: number
  readonly stopAfterMs?: number
}

export type EngineDetector = {
  readonly observe: (ts: number, rpm: number | undefined) => EngineSignal
  readonly adoptRunning: (ts: number) => void
  readonly reset: () => void
  readonly running: () => boolean
  readonly startingSince: () => number | undefined
}

export const makeEngineDetector = (config: EngineDetectorConfig = {}): EngineDetector => {
  const startRpm = config.startRpm ?? START_RPM
  const startHoldMs = config.startHoldMs ?? START_HOLD_MS
  const stopAfterMs = config.stopAfterMs ?? STOP_AFTER_MS
  let running = false
  let onSince: number | undefined
  let offSince: number | undefined
  return {
    observe: (ts, rpm) => {
      const on = rpm !== undefined && rpm > startRpm
      if (!running) {
        if (!on) {
          onSince = undefined
          return "none"
        }
        onSince ??= ts
        if (ts - onSince >= startHoldMs) {
          running = true
          onSince = undefined
          offSince = undefined
          return "started"
        }
        return "none"
      }
      if (on) {
        offSince = undefined
        return "none"
      }
      offSince ??= ts
      if (ts - offSince >= stopAfterMs) {
        running = false
        offSince = undefined
        return "stopped"
      }
      return "none"
    },
    adoptRunning: (ts) => {
      running = true
      onSince = undefined
      offSince = undefined
      void ts
    },
    reset: () => {
      running = false
      onSince = undefined
      offSince = undefined
    },
    running: () => running,
    startingSince: () => onSince
  }
}
