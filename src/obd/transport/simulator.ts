/**
 * A lightweight vehicle model that produces plausible, time-varying OBD-II data
 * so the app (live dashboard, logging, DPF analysis) can be developed and demoed
 * without a real car. It returns the raw *data bytes* for a given PID so that the
 * real decoders are exercised end-to-end.
 *
 * It also models a DPF soot-load cycle with periodic regenerations (EGT spike +
 * soot drop) to drive the DPF Analysis view offline.
 */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function u16(value: number): [number, number] {
  const v = clamp(Math.round(value), 0, 0xffff)
  return [(v >> 8) & 0xff, v & 0xff]
}

export interface SimState {
  rpm: number
  speedKmh: number
  coolantC: number
  intakeC: number
  ambientC: number
  engineLoadPct: number
  throttlePct: number
  mafGs: number
  mapKpa: number
  moduleVoltage: number
  fuelPct: number
  /** DPF soot load in grams per litre (typical warning threshold ~ 24 g/L). */
  dpfSootGl: number
  /** Exhaust gas temperature at the DPF inlet, °C. */
  egtC: number
  /** 1 while an active regeneration is in progress, else 0. */
  regenActive: number
  /** Kilometres since the last completed regeneration. */
  kmSinceRegen: number
  /** Lifetime count of regenerations that ran to completion. */
  regenOkCount: number
  /** Lifetime count of regenerations interrupted before completing. */
  regenDisruptedCount: number
  /** Lifetime count of regenerations the ECU restarted after a disruption. */
  regenRetriedCount: number
}

export class VehicleSimulator {
  private readonly startMs: number
  private lastSoot = 2

  constructor(now: number = Date.now()) {
    this.startMs = now
  }

  /** Compute the full vehicle state at time `now`. */
  state(now: number = Date.now()): SimState {
    const t = (now - this.startMs) / 1000 // seconds since start

    // Warm-up curve: idle -> operating temperature over ~4 minutes.
    const warm = 1 - Math.exp(-t / 120)
    const coolantC = 20 + warm * 68 // 20 -> 88 °C
    const intakeC = 18 + warm * 22
    const ambientC = 16

    // A gentle drive cycle: cruise with occasional acceleration.
    const cruise = 0.5 + 0.5 * Math.sin(t / 40)
    const speedKmh = clamp(60 + 45 * Math.sin(t / 55) + 8 * Math.sin(t / 7), 0, 130)
    const rpm = clamp(850 + speedKmh * 22 + 300 * Math.sin(t / 5), 750, 4200)
    const engineLoadPct = clamp(18 + 55 * cruise + 10 * Math.sin(t / 6), 0, 100)
    const throttlePct = clamp(engineLoadPct * 0.8, 0, 100)
    const mafGs = clamp((rpm / 1000) * (2 + engineLoadPct / 20), 1, 120)
    const mapKpa = clamp(40 + engineLoadPct * 1.6, 20, 250)

    // DPF soot accumulates with load; a regen every ~600 s burns it off with an
    // EGT spike, which is exactly the signature the DPF Analysis view detects.
    const cyclePos = t % 600
    const regenActive = cyclePos > 480 && cyclePos < 560 ? 1 : 0
    let dpfSootGl: number
    if (regenActive) {
      dpfSootGl = clamp(this.lastSoot - (cyclePos - 480) * 0.28, 1.5, 30)
    } else {
      dpfSootGl = clamp(2 + (cyclePos / 600) * 22 + engineLoadPct * 0.02, 1.5, 30)
    }
    this.lastSoot = dpfSootGl
    const egtC = regenActive ? 560 + 60 * Math.sin(t) : 180 + engineLoadPct * 3.2
    const kmSinceRegen = ((cyclePos / 600) * 320) | 0

    // Monotonic lifetime counters for a well-used van: every ~600 s cycle ends
    // with a completed regen; a minority are disrupted (and then mostly retried).
    const completed = Math.floor(t / 600)
    const regenOkCount = 128 + completed
    const regenDisruptedCount = 11 + Math.floor(t / 3000)
    const regenRetriedCount = 9 + Math.floor(t / 3600)

    return {
      rpm,
      speedKmh,
      coolantC,
      intakeC,
      ambientC,
      engineLoadPct,
      throttlePct,
      mafGs,
      mapKpa,
      moduleVoltage: 14.1 - engineLoadPct * 0.004,
      fuelPct: clamp(80 - t / 600, 5, 100),
      dpfSootGl,
      egtC,
      regenActive,
      kmSinceRegen,
      regenOkCount,
      regenDisruptedCount,
      regenRetriedCount,
    }
  }

  /**
   * Raw data bytes for a Mode 01 (or seeded experimental) PID, or `null` if this
   * simulated ECU does not support it.
   */
  dataBytes(mode: number, pid: number, now: number = Date.now()): number[] | null {
    const s = this.state(now)
    if (mode === 0x01) {
      switch (pid) {
        case 0x04:
          return [Math.round((s.engineLoadPct * 255) / 100)]
        case 0x05:
          return [Math.round(s.coolantC + 40)]
        case 0x0b:
          return [Math.round(s.mapKpa)]
        case 0x0c:
          return u16(s.rpm * 4)
        case 0x0d:
          return [Math.round(s.speedKmh)]
        case 0x0f:
          return [Math.round(s.intakeC + 40)]
        case 0x10:
          return u16(s.mafGs * 100)
        case 0x11:
          return [Math.round((s.throttlePct * 255) / 100)]
        case 0x2f:
          return [Math.round((s.fuelPct * 255) / 100)]
        case 0x42:
          return u16(s.moduleVoltage * 1000)
        case 0x46:
          return [Math.round(s.ambientC + 40)]
        default:
          return null
      }
    }
    // Experimental Fiat-style DPF PIDs (Mode 22) — placeholder encodings used only
    // by the simulator; real formulas are verified on the vehicle.
    if (mode === 0x22) {
      switch (pid) {
        case 0x18f0: // soot mass g/L * 10
          return u16(s.dpfSootGl * 10)
        case 0x18f1: // EGT, offset -40 in 0.1 steps
          return u16((s.egtC + 40) * 10)
        case 0x18f2: // regen active flag
          return [s.regenActive]
        case 0x18f3: // km since regen
          return u16(s.kmSinceRegen)
        case 0x18f4: // successful regen count
          return u16(s.regenOkCount)
        case 0x18f5: // disrupted regen count
          return u16(s.regenDisruptedCount)
        case 0x18f6: // retried regen count
          return u16(s.regenRetriedCount)
        default:
          return null
      }
    }
    return null
  }
}
