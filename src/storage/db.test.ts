import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteSession, sessionDtcEvents, sessionSamples, type NewDtcEvent } from './db'

beforeEach(async () => {
  await db.samples.clear()
  await db.dtcEvents.clear()
  await db.sessions.clear()
})

const dtcEvent = (over: Partial<NewDtcEvent> & Pick<NewDtcEvent, 'sessionId' | 'ts'>): NewDtcEvent => ({
  kind: 'appeared',
  code: 'P2002',
  status: 'stored',
  system: 'powertrain',
  manufacturerSpecific: false,
  ...over,
})

describe('storage db', () => {
  it('orders samples by time via the [sessionId+ts] index', async () => {
    const id = await db.sessions.add({
      note: '',
      startedAt: 1,
      endedAt: null,
      transportKind: 'mock',
      pidIds: ['std.rpm'],
      sampleCount: 0,
      syncSessionId: 'test-sync-id',
      syncCursorId: 0,
      syncDtcCursorId: 0,
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
      note: '',
      startedAt: 1,
      endedAt: null,
      transportKind: 'mock',
      pidIds: [],
      sampleCount: 0,
      syncSessionId: 'test-sync-id',
      syncCursorId: 0,
      syncDtcCursorId: 0,
    })
    const drop = await db.sessions.add({
      note: '',
      startedAt: 2,
      endedAt: null,
      transportKind: 'mock',
      pidIds: [],
      sampleCount: 0,
      syncSessionId: 'test-sync-id',
      syncCursorId: 0,
      syncDtcCursorId: 0,
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

  it('orders DTC events by time and scopes them per session', async () => {
    await db.dtcEvents.bulkAdd([
      dtcEvent({ sessionId: 1, ts: 30, kind: 'cleared' }),
      dtcEvent({ sessionId: 1, ts: 10 }),
      dtcEvent({ sessionId: 2, ts: 20 }),
      dtcEvent({ sessionId: 1, ts: 20, code: 'P0401' }),
    ])
    const rows = await sessionDtcEvents(1)
    expect(rows.map((r) => r.ts)).toEqual([10, 20, 30])
    expect(rows.every((r) => r.sessionId === 1)).toBe(true)
  })

  it('cascades delete to a session\'s DTC events', async () => {
    await db.dtcEvents.bulkAdd([
      dtcEvent({ sessionId: 1, ts: 1 }),
      dtcEvent({ sessionId: 2, ts: 1 }),
      dtcEvent({ sessionId: 2, ts: 2, kind: 'cleared' }),
    ])
    await deleteSession(2)
    expect(await db.dtcEvents.count()).toBe(1)
    expect(await db.dtcEvents.where('sessionId').equals(1).count()).toBe(1)
  })
})
