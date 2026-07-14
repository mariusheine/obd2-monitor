import Dexie, { type EntityTable } from 'dexie'

import type { DtcSystem } from '@/obd/dtc/decode'

/** A recorded drive session. */
export interface SessionRow {
  id: number
  note: string
  startedAt: number
  endedAt: number | null
  transportKind: string
  /** PID ids that were being recorded. */
  pidIds: string[]
  sampleCount: number
  /**
   * Stable id shared by every cloud chunk of this session, so chunks uploaded
   * from any device group and reassemble unambiguously (see {@link ../stores/sync}).
   */
  syncSessionId: string
  /** Highest sample `id` already uploaded to the cloud (0 = nothing yet). */
  syncCursorId: number
  /** Highest DTC-event `id` already uploaded to the cloud (0 = nothing yet). */
  syncDtcCursorId: number
}

/** A collision-resistant id for cloud sync grouping. */
export function newSyncId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** A single logged reading. */
export interface SampleRow {
  id: number
  sessionId: number
  ts: number
  pidId: string
  value: number
}

/** Which DTC set a code was observed in. */
export type DtcStatus = 'stored' | 'pending' | 'permanent'
/**
 * A DTC state change logged during a recording: a code `appeared`, a code
 * `cleared` on its own (detected by the monitor's diff), or the driver did a
 * deliberate Mode-04 `manual-clear` (one event per code wiped).
 */
export type DtcEventKind = 'appeared' | 'cleared' | 'manual-clear'

/**
 * A diagnostic-trouble-code state change logged during a drive: a code that
 * appeared or cleared, stamped on the same epoch-ms clock as {@link SampleRow}
 * so it aligns onto the live-PID timeline.
 */
export interface DtcEventRow {
  id: number
  sessionId: number
  /** Epoch milliseconds — same clock as {@link SampleRow.ts}. */
  ts: number
  kind: DtcEventKind
  /** Standard 5-char code, e.g. `P2002`. */
  code: string
  status: DtcStatus
  system: DtcSystem
  manufacturerSpecific: boolean
  description?: string
}

export type NewSession = Omit<SessionRow, 'id'>
export type NewSample = Omit<SampleRow, 'id'>
export type NewDtcEvent = Omit<DtcEventRow, 'id'>

/**
 * IndexedDB (via Dexie). `samples` is the high-volume time-series table — a long
 * drive is hundreds of thousands of rows, so writes are batched (see the session
 * store) and the `[sessionId+ts]` compound index keeps per-session export ordered
 * and fast.
 */
export const db = new Dexie('obd2-monitor') as Dexie & {
  sessions: EntityTable<SessionRow, 'id'>
  samples: EntityTable<SampleRow, 'id'>
  dtcEvents: EntityTable<DtcEventRow, 'id'>
}

db.version(1).stores({
  sessions: '++id, startedAt',
  samples: '++id, sessionId, [sessionId+ts]',
})

// v2 adds the [sessionId+id] index so the cloud sync engine can page "samples
// newer than the last uploaded id" cheaply, plus the sync-tracking fields on
// sessions (backfilled for pre-existing rows).
db.version(2)
  .stores({
    sessions: '++id, startedAt',
    samples: '++id, sessionId, [sessionId+ts], [sessionId+id]',
  })
  .upgrade((tx) =>
    tx
      .table<SessionRow, number>('sessions')
      .toCollection()
      .modify((s) => {
        s.syncSessionId ??= newSyncId()
        s.syncCursorId ??= 0
      }),
  )

// v3 adds the dtcEvents time-series table (mirroring samples' indexes: [sessionId+ts]
// for ordered export, [sessionId+id] for cloud paging) and the DTC sync cursor.
db.version(3)
  .stores({
    sessions: '++id, startedAt',
    samples: '++id, sessionId, [sessionId+ts], [sessionId+id]',
    dtcEvents: '++id, sessionId, [sessionId+ts], [sessionId+id]',
  })
  .upgrade((tx) =>
    tx
      .table<SessionRow, number>('sessions')
      .toCollection()
      .modify((s) => {
        s.syncDtcCursorId ??= 0
      }),
  )

/** Delete a session and all of its samples and DTC events in one transaction. */
export async function deleteSession(sessionId: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.samples, db.dtcEvents, async () => {
    await db.samples.where('sessionId').equals(sessionId).delete()
    await db.dtcEvents.where('sessionId').equals(sessionId).delete()
    await db.sessions.delete(sessionId)
  })
}

/** Samples for a session, ordered by time (for review and export). */
export function sessionSamples(sessionId: number): Promise<SampleRow[]> {
  return db.samples
    .where('[sessionId+ts]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .toArray()
}

/** DTC events for a session, ordered by time (for review and export). */
export function sessionDtcEvents(sessionId: number): Promise<DtcEventRow[]> {
  return db.dtcEvents
    .where('[sessionId+ts]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .toArray()
}

export interface StorageEstimate {
  usage: number
  quota: number
}

/** Best-effort storage usage, or null if the browser doesn't expose it. */
export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  const est = await navigator.storage.estimate()
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
}
