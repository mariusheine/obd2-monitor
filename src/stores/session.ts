import { defineStore } from 'pinia'
import { ref } from 'vue'

import { db, newSyncId, type NewSample } from '@/storage/db'
import type { Sample } from '@/obd/pids/types'
import { useConnectionStore } from './connection'
import { useDtcMonitorStore } from './dtcMonitor'
import { useLiveStore } from './live'

const FLUSH_INTERVAL_MS = 1500
const FLUSH_THRESHOLD = 500

/**
 * Instantiate the cloud-sync store (which starts its upload interval) and give
 * it an immediate tick. Called on record start so a drive syncs from the moment
 * it begins — not only once the Sessions/Settings tab is first opened. The store
 * is dynamically imported so its WebDAV/Dexie code stays out of the initial
 * bundle; it's a no-op when sync is unconfigured or disabled.
 */
function nudgeSync(): void {
  void import('./sync')
    .then(({ useSyncStore }) => useSyncStore().tick())
    .catch(() => undefined)
}

/**
 * Records the live sample stream into IndexedDB as a drive session. Samples are
 * buffered and written in batches (by count or on an interval) to keep IndexedDB
 * writes off the hot path during a drive.
 */
export const useSessionStore = defineStore('session', () => {
  const recording = ref(false)
  const currentId = ref<number | null>(null)
  const startedAt = ref<number | null>(null)
  const sampleCount = ref(0)

  let buffer: NewSample[] = []
  let unsubscribe: (() => void) | null = null
  let flushTimer: ReturnType<typeof setInterval> | undefined

  async function flush(): Promise<void> {
    const sessionId = currentId.value
    if (sessionId === null || buffer.length === 0) return
    const batch = buffer
    buffer = []
    await db.samples.bulkAdd(batch)
    sampleCount.value += batch.length
    await db.sessions.update(sessionId, { sampleCount: sampleCount.value })
  }

  function onSample(sample: Sample): void {
    if (currentId.value === null) return
    buffer.push({
      sessionId: currentId.value,
      ts: sample.ts,
      pidId: sample.pidId,
      value: sample.value,
    })
    if (buffer.length >= FLUSH_THRESHOLD) void flush()
  }

  async function start(): Promise<void> {
    if (recording.value) return
    const live = useLiveStore()
    const conn = useConnectionStore()
    const now = Date.now()
    const id = await db.sessions.add({
      note: '',
      startedAt: now,
      endedAt: null,
      transportKind: conn.kind ?? 'unknown',
      pidIds: live.activePids.map((p) => p.id),
      sampleCount: 0,
      syncSessionId: newSyncId(),
      syncCursorId: 0,
      syncDtcCursorId: 0,
    })
    currentId.value = id
    startedAt.value = now
    sampleCount.value = 0
    buffer = []
    recording.value = true
    unsubscribe = live.addSampleListener(onSample)
    flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
    // Watch trouble codes for the length of the drive, logged against this session.
    useDtcMonitorStore().start(id)
    // Start the cloud-sync engine now so uploads run during the drive.
    nudgeSync()
  }

  async function stop(): Promise<void> {
    if (!recording.value) return
    recording.value = false
    useDtcMonitorStore().stop()
    if (flushTimer) clearInterval(flushTimer)
    flushTimer = undefined
    unsubscribe?.()
    unsubscribe = null
    await flush()
    if (currentId.value !== null) {
      await db.sessions.update(currentId.value, { endedAt: Date.now() })
    }
    currentId.value = null
    startedAt.value = null
    // Nudge the sync engine to upload the tail promptly (best-effort).
    nudgeSync()
  }

  return { recording, currentId, startedAt, sampleCount, start, stop }
})
