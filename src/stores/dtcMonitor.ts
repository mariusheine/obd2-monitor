import { defineStore } from 'pinia'
import { ref } from 'vue'

import { db, type NewDtcEvent } from '@/storage/db'
import { diffDtcs, readActiveDtcs, type ActiveDtc } from '@/obd/dtc/monitor'
import { useConnectionStore } from './connection'

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
      prev = next
      active.value = next
      lastPollAt.value = now
      lastError.value = null
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

  /** Begin watching for the given recording session. */
  function start(id: number): void {
    stop()
    sessionId = id
    prev = []
    active.value = []
    recentEvents.value = []
    lastError.value = null
    monitoring.value = true
    void poll() // capture codes already present at drive start
    timer = setInterval(() => void poll(), DTC_POLL_INTERVAL_MS)
  }

  /** Stop watching; the last active set/feed are kept for display until the next start. */
  function stop(): void {
    if (timer) clearInterval(timer)
    timer = undefined
    sessionId = null
    monitoring.value = false
  }

  return { active, recentEvents, lastPollAt, lastError, monitoring, start, stop }
})
