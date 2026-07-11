import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { db } from '@/storage/db'
import { useConnectionStore } from './connection'
import { useLiveStore } from './live'
import { useSessionStore } from './session'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.samples.clear()
  await db.sessions.clear()
  localStorage.clear()
})

describe('auto-record on connect', () => {
  it('starts polling + recording on connect and stops on disconnect', async () => {
    const conn = useConnectionStore()
    const live = useLiveStore()
    const session = useSessionStore()

    await conn.connect('mock')
    expect(conn.status).toBe('connected')
    expect(live.polling).toBe(true)
    expect(session.recording).toBe(true)
    expect(await db.sessions.count()).toBe(1)

    await conn.disconnect()
    expect(session.recording).toBe(false)
    expect(live.polling).toBe(false)
    const row = (await db.sessions.toArray())[0]!
    expect(row.endedAt).not.toBeNull()
  })

  it('does not open a second session while already recording (reconnect-safe)', async () => {
    const conn = useConnectionStore()
    const session = useSessionStore()

    await conn.connect('mock')
    expect(await db.sessions.count()).toBe(1)

    // The reconnect path resumes polling and may call start() again — it must no-op.
    await session.start()
    expect(await db.sessions.count()).toBe(1)
    expect(session.recording).toBe(true)
  })
})
