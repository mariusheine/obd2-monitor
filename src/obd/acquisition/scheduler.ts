import type { Elm327 } from '../elm327/Elm327'
import { getPid } from '../pids/catalog'
import type { PidCategory, PidDefinition, Sample } from '../pids/types'

/** A PID to poll and how often (milliseconds between requests). */
export interface PollSpec {
  pidId: string
  intervalMs: number
}

export interface SchedulerCallbacks {
  onSample: (sample: Sample) => void
  onError?: (pidId: string, error: unknown) => void
}

interface ScheduledPid {
  def: PidDefinition
  intervalMs: number
  nextDue: number
}

/** Sensible default poll interval (ms) for a PID, based on how fast it changes. */
export function defaultPollMs(category: PidCategory): number {
  switch (category) {
    case 'engine':
    case 'speed':
      return 250
    case 'pressure':
      return 500
    case 'temperature':
    case 'dpf':
      return 1000
    case 'fuel':
    case 'electrical':
      return 2000
    default:
      return 1000
  }
}

/** Build poll specs for a list of PID ids using each PID's default rate. */
export function buildPollSpecs(pidIds: readonly string[]): PollSpec[] {
  const specs: PollSpec[] = []
  for (const id of pidIds) {
    const def = getPid(id)
    if (def) specs.push({ pidId: id, intervalMs: defaultPollMs(def.category) })
  }
  return specs
}

/**
 * Bandwidth-aware polling engine.
 *
 * The ELM327 handles one request at a time, so this never issues concurrent
 * queries. On each iteration it picks the most-overdue PID, queries it, decodes
 * it, and reschedules it `intervalMs` into the future (measured from now, so a
 * slow bus degrades the rate gracefully instead of building an unbounded backlog).
 */
export class AcquisitionScheduler {
  private running = false
  private pids: ScheduledPid[] = []

  constructor(
    private readonly elm: Elm327,
    private readonly callbacks: SchedulerCallbacks,
    private readonly now: () => number = Date.now,
  ) {}

  setPids(specs: readonly PollSpec[]): void {
    const start = this.now()
    this.pids = []
    for (const spec of specs) {
      const def = getPid(spec.pidId)
      if (!def) continue
      this.pids.push({ def, intervalMs: spec.intervalMs, nextDue: start })
    }
  }

  get pidCount(): number {
    return this.pids.length
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  private nextPid(): ScheduledPid | null {
    let soonest: ScheduledPid | null = null
    for (const p of this.pids) {
      if (!soonest || p.nextDue < soonest.nextDue) soonest = p
    }
    return soonest
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const target = this.nextPid()
      if (!target) {
        await delay(50)
        continue
      }
      const wait = target.nextDue - this.now()
      if (wait > 0) {
        await delay(Math.min(wait, 100))
        continue
      }
      // Reschedule from "now" so we don't accumulate a backlog on a slow bus.
      target.nextDue = this.now() + target.intervalMs
      try {
        const res = await this.elm.query(target.def.mode, target.def.pid)
        if (!this.running) break // stopped while this request was in flight
        const value = target.def.decode(res.data)
        if (value !== null && Number.isFinite(value)) {
          this.callbacks.onSample({ pidId: target.def.id, value, ts: this.now() })
        }
      } catch (err) {
        if (!this.running) break
        this.callbacks.onError?.(target.def.id, err)
        // Back off on errors (e.g. a dropped link) so we don't busy-spin.
        await delay(50)
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
