import { defineStore } from 'pinia'
import { ref } from 'vue'

import { db, type NewDtcEvent } from '@/storage/db'
import { diffDtcs, readActiveDtcs, type ActiveDtc } from '@/obd/dtc/monitor'
import { useConnectionStore } from './connection'
import { useDtcAlertStore } from './dtcAlert'

/** How often to re-read the trouble codes while recording. DTCs change slowly. */
const DTC_POLL_INTERVAL_MS = 20_000
/** Cap on the in-memory feed shown by the live indicator. */
const RECENT_EVENTS_MAX = 20

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Watches the diagnostic trouble codes while a drive is recording. On a slow
 * timer it re-reads the stored/pending/permanent sets, diffs against the last
 * read, and logs every appear/clear transition to IndexedDB stamped on the same
 * epoch-ms clock as the PID samples (so errors align to the live-PID timeline).
 * Started/stopped by the session recorder; see {@link ../obd/dtc/monitor}.
 */
export const useDtcMonitorStore = defineStore('dtcMonitor', () => {
  /** Codes present at the most recent poll. */
  const active = ref<ActiveDtc[]>([])
  /** Newest-first feed of recent appear/clear transitions, for the live indicator. */
  const recentEvents = ref<NewDtcEvent[]>([])
  const lastPollAt = ref<number | null>(null)
  const lastError = ref<string | null>(null)
  const monitoring = ref(false)

  let sessionId: number | null = null
  let prev: ActiveDtc[] = []
  // False until the first poll of a drive completes; codes present at drive start
  // are logged but must NOT alert. A dedicated flag (not `prev.length === 0`) so a
  // drive that starts clean still alerts on its first genuinely new code.
  let seeded = false
  let timer: ReturnType<typeof setInterval> | undefined
  let busy = false

  async function poll(): Promise<void> {
    if (busy || sessionId === null) return
    const conn = useConnectionStore()
    const elm = conn.elm
    // Skip while disconnected/reconnecting — the elm is swapped on reconnect, so
    // it's read fresh each tick rather than captured at start.
    if (conn.status !== 'connected' || !elm) return
    busy = true
    try {
      const next = await readActiveDtcs(elm)
      const now = Date.now()
      const { appeared, cleared } = diffDtcs(prev, next)
      const events: NewDtcEvent[] = [
        ...cleared.map((d) => toEvent(d, 'cleared', now)),
        ...appeared.map((d) => toEvent(d, 'appeared', now)),
      ]
      if (events.length > 0) {
        await db.dtcEvents.bulkAdd(events)
        recentEvents.value = [...events].reverse().concat(recentEvents.value).slice(0, RECENT_EVENTS_MAX)
      }
      // Alert only on codes that appear *after* the seed poll (see `seeded`).
      const firstNew = appeared[0]
      if (seeded && firstNew) useDtcAlertStore().signal({ ...firstNew, ts: now })
      prev = next
      active.value = next
      lastPollAt.value = now
      lastError.value = null
      seeded = true
    } catch (err) {
      lastError.value = errorMessage(err)
    } finally {
      busy = false
    }
  }

  function toEvent(d: ActiveDtc, kind: NewDtcEvent['kind'], ts: number): NewDtcEvent {
    return {
      sessionId: sessionId!,
      ts,
      kind,
      code: d.code,
      status: d.status,
      system: d.system,
      manufacturerSpecific: d.manufacturerSpecific,
      description: d.description,
    }
  }

  /**
   * Log a deliberate Mode-04 clear against the active recording: one `manual-clear`
   * event per code being wiped (stored/pending — permanent codes survive Mode 04),
   * so the deletion is marked on the charts and revealed in the session. No-op when
   * not recording or when there are no clearable codes. Also drops the wiped codes
   * from the tracked set so the next poll doesn't re-log them as a plain `cleared`.
   * Call right after the `04` succeeds, before re-reading the (now empty) sets.
   */
  async function recordManualClear(): Promise<void> {
    if (sessionId === null) return
    const wiped = active.value.filter((d) => d.status !== 'permanent')
    if (wiped.length === 0) return
    const now = Date.now()
    const events = wiped.map((d) => toEvent(d, 'manual-clear', now))
    await db.dtcEvents.bulkAdd(events)
    recentEvents.value = [...events].reverse().concat(recentEvents.value).slice(0, RECENT_EVENTS_MAX)
    const remaining = active.value.filter((d) => d.status === 'permanent')
    prev = remaining
    active.value = remaining
  }

  /** Begin watching for the given recording session. */
  function start(id: number): void {
    stop()
    sessionId = id
    prev = []
    seeded = false
    active.value = []
    recentEvents.value = []
    useDtcAlertStore().reset()
    lastError.value = null
    monitoring.value = true
    void poll() // capture codes already present at drive start (seed, no alert)
    timer = setInterval(() => void poll(), DTC_POLL_INTERVAL_MS)
  }

  /** Stop watching; the last active set/feed are kept for display until the next start. */
  function stop(): void {
    if (timer) clearInterval(timer)
    timer = undefined
    sessionId = null
    monitoring.value = false
  }

  return {
    active,
    recentEvents,
    lastPollAt,
    lastError,
    monitoring,
    start,
    stop,
    recordManualClear,
  }
})
