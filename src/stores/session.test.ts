import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { Elm327 } from '@/obd/elm327/Elm327'
import { MockTransport } from '@/obd/transport/MockTransport'
import { db } from '@/storage/db'
import { useLiveStore } from './live'
import { useSessionStore } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.samples.clear()
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
})
