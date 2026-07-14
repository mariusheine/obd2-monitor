/**
 * Small "alert while driving" primitive: a short vibration and an optional beep,
 * used when a new trouble code appears mid-drive. Both need the page foregrounded
 * (which the wake lock ensures while polling). The beep additionally needs the
 * AudioContext to have been created/resumed inside a user gesture, so call
 * `prime()` from the first tap (see App.vue's one-shot pointer listener) before
 * the first beep — otherwise the browser leaves the context suspended and silent.
 *
 * The AudioContext is a module-level singleton so priming from one caller unlocks
 * the beep for every caller.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

let sharedCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!Ctor) return null
  try {
    sharedCtx = new Ctor()
  } catch {
    return null
  }
  return sharedCtx
}

export function useAlert(): {
  /** Unlock audio — call synchronously from a user gesture. */
  prime: () => void
  /** Vibrate if supported; no-op otherwise. */
  vibrate: (pattern?: number | number[]) => void
  /** Two short rising beeps; silent until primed. */
  beep: () => void
} {
  function prime(): void {
    const ctx = getCtx()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  function vibrate(pattern: number | number[] = [120, 60, 120]): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern)
      } catch {
        // Some browsers throw if vibration is disallowed; non-fatal.
      }
    }
  }

  function tone(ctx: AudioContext, freq: number, start: number, duration: number): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // Short attack/decay envelope so it clicks cleanly rather than popping.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + duration)
  }

  function beep(): void {
    const ctx = getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime
    tone(ctx, 660, t0, 0.18)
    tone(ctx, 990, t0 + 0.2, 0.22)
  }

  return { prime, vibrate, beep }
}
