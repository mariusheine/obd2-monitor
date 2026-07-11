import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteSession, sessionSamples } from './db'

beforeEach(async () => {
  await db.samples.clear()
  await db.sessions.clear()
})

describe('storage db', () => {
  it('orders samples by time via the [sessionId+ts] index', async () => {
    const id = await db.sessions.add({
      label: 'a',
      note: '',
      startedAt: 1,
      endedAt: null,
      transportKind: 'mock',
      pidIds: ['std.rpm'],
      sampleCount: 0,
    })
    await db.samples.bulkAdd([
      { sessionId: id, ts: 3, pidId: 'std.rpm', value: 1 },
      { sessionId: id, ts: 1, pidId: 'std.rpm', value: 2 },
      { sessionId: id, ts: 2, pidId: 'std.rpm', value: 3 },
    ])
    const rows = await sessionSamples(id)
    expect(rows.map((r) => r.ts)).toEqual([1, 2, 3])
  })

  it('cascades delete to a session\'s samples', async () => {
    const keep = await db.sessions.add({
      label: 'keep',
      note: '',
      startedAt: 1,
      endedAt: null,
      transportKind: 'mock',
      pidIds: [],
      sampleCount: 0,
    })
    const drop = await db.sessions.add({
      label: 'drop',
      note: '',
      startedAt: 2,
      endedAt: null,
      transportKind: 'mock',
      pidIds: [],
      sampleCount: 0,
    })
    await db.samples.bulkAdd([
      { sessionId: keep, ts: 1, pidId: 'p', value: 1 },
      { sessionId: drop, ts: 1, pidId: 'p', value: 1 },
      { sessionId: drop, ts: 2, pidId: 'p', value: 2 },
    ])
    await deleteSession(drop)
    expect(await db.sessions.count()).toBe(1)
    expect(await db.samples.count()).toBe(1)
    expect(await db.samples.where('sessionId').equals(keep).count()).toBe(1)
  })
})
