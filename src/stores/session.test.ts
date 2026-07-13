import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { Elm327 } from '@/obd/elm327/Elm327'
import { MockTransport } from '@/obd/transport/MockTransport'
import { db } from '@/storage/db'
import { useConnectionStore } from './connection'
import { useLiveStore } from './live'
import { useSessionStore } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.samples.clear()
  await db.dtcEvents.clear()
  await db.sessions.clear()
})

describe('session recorder (end-to-end)', () => {
  it('records the live pipeline into IndexedDB and finalises the session', async () => {
    const transport = new MockTransport(0)
    await transport.connect()
    const elm = new Elm327(transport)
    await elm.init()

    const live = useLiveStore()
    const session = useSessionStore()

    live.start(elm, [
      { pidId: 'std.rpm', intervalMs: 10 },
      { pidId: 'std.coolantTemp', intervalMs: 10 },
    ])
    await session.start()
    expect(session.recording).toBe(true)

    await wait(200)
    await session.stop()
    live.stop()

    expect(session.recording).toBe(false)

    const sessions = await db.sessions.toArray()
    expect(sessions).toHaveLength(1)
    const row = sessions[0]!
    expect(row.endedAt).not.toBeNull()

    const count = await db.samples.where('sessionId').equals(row.id).count()
    expect(count).toBeGreaterThan(0)
    // The persisted sampleCount matches what's actually stored.
    expect(row.sampleCount).toBe(count)
  })

  it('watches DTCs while recording and logs the codes present at drive start', async () => {
    // connect('mock') brings up the pipeline (live + recorder + DTC monitor).
    const conn = useConnectionStore()
    await conn.connect('mock')
    expect(conn.status).toBe('connected')

    // The immediate DTC poll on record start logs codes already present as "appeared".
    await vi.waitFor(async () => {
      expect(await db.dtcEvents.count()).toBeGreaterThan(0)
    })
    const events = await db.dtcEvents.toArray()
    expect(events.every((e) => e.kind === 'appeared')).toBe(true)
    expect(events.some((e) => e.code === 'P2002')).toBe(true)
    const sessionId = useSessionStore().currentId
    expect(events.every((e) => e.sessionId === sessionId)).toBe(true)

    await conn.disconnect()
  })
})
