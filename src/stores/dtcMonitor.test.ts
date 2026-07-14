import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { db } from '@/storage/db'
import { useConnectionStore } from './connection'
import { useDtcMonitorStore } from './dtcMonitor'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.samples.clear()
  await db.dtcEvents.clear()
  await db.sessions.clear()
})

describe('dtcMonitor.recordManualClear', () => {
  it('logs a manual clear as manual-clear events and drops the wiped codes', async () => {
    // connect('mock') starts the pipeline (live + recorder + DTC monitor); the
    // seed poll populates the active set with the simulator's codes.
    const conn = useConnectionStore()
    await conn.connect('mock')
    const monitor = useDtcMonitorStore()

    await vi.waitFor(() => {
      expect(monitor.active.length).toBeGreaterThan(0)
    })

    const wiped = monitor.active.filter((d) => d.status !== 'permanent').map((d) => d.code)
    expect(wiped.length).toBeGreaterThan(0)

    await monitor.recordManualClear()

    const manual = (await db.dtcEvents.toArray()).filter((e) => e.kind === 'manual-clear')
    expect(manual.length).toBe(wiped.length)
    expect(manual.map((e) => e.code).sort()).toEqual([...wiped].sort())
    // Every recorded manual-clear is stamped to the active recording session.
    const sessionId = manual[0]?.sessionId
    expect(sessionId).toBeDefined()
    expect(manual.every((e) => e.sessionId === sessionId)).toBe(true)
    // The wiped (non-permanent) codes are gone from the tracked active set.
    expect(monitor.active.every((d) => d.status === 'permanent')).toBe(true)

    await conn.disconnect()
  })

  it('does nothing when not recording', async () => {
    const monitor = useDtcMonitorStore()
    await monitor.recordManualClear()
    expect(await db.dtcEvents.count()).toBe(0)
  })
})
