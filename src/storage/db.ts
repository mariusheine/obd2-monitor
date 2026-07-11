import Dexie, { type EntityTable } from 'dexie'

/** A recorded drive session. */
export interface SessionRow {
  id: number
  label: string
  note: string
  startedAt: number
  endedAt: number | null
  transportKind: string
  /** PID ids that were being recorded. */
  pidIds: string[]
  sampleCount: number
}

/** A single logged reading. */
export interface SampleRow {
  id: number
  sessionId: number
  ts: number
  pidId: string
  value: number
}

export type NewSession = Omit<SessionRow, 'id'>
export type NewSample = Omit<SampleRow, 'id'>

/**
 * IndexedDB (via Dexie). `samples` is the high-volume time-series table — a long
 * drive is hundreds of thousands of rows, so writes are batched (see the session
 * store) and the `[sessionId+ts]` compound index keeps per-session export ordered
 * and fast.
 */
export const db = new Dexie('obd2-monitor') as Dexie & {
  sessions: EntityTable<SessionRow, 'id'>
  samples: EntityTable<SampleRow, 'id'>
}

db.version(1).stores({
  sessions: '++id, startedAt',
  samples: '++id, sessionId, [sessionId+ts]',
})

/** Delete a session and all of its samples in one transaction. */
export async function deleteSession(sessionId: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.samples, async () => {
    await db.samples.where('sessionId').equals(sessionId).delete()
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
