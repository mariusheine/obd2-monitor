import { describe, expect, it } from 'vitest'
import { Reconnector } from './Reconnector'

const flush = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Reconnector', () => {
  it('retries with backoff until an attempt succeeds', async () => {
    let calls = 0
    const statuses: string[] = []
    const r = new Reconnector({
      attempt: async () => {
        calls += 1
        if (calls < 3) throw new Error('still down')
      },
      backoffMs: () => 5,
      onStatus: (s) => statuses.push(s),
    })
    r.start()
    await flush(60)
    expect(calls).toBe(3)
    expect(statuses).toContain('connected')
    expect(statuses.filter((s) => s === 'reconnecting').length).toBeGreaterThanOrEqual(3)
  })

  it('gives up after maxAttempts and reports failed', async () => {
    let calls = 0
    const statuses: string[] = []
    const r = new Reconnector({
      attempt: async () => {
        calls += 1
        throw new Error('nope')
      },
      maxAttempts: 3,
      backoffMs: () => 5,
      onStatus: (s) => statuses.push(s),
    })
    r.start()
    await flush(60)
    expect(calls).toBe(3)
    expect(statuses).toContain('failed')
    expect(statuses).not.toContain('connected')
  })

  it('stop() halts further attempts', async () => {
    let calls = 0
    const r = new Reconnector({
      attempt: async () => {
        calls += 1
        throw new Error('down')
      },
      backoffMs: () => 10,
    })
    r.start()
    await flush(15)
    r.stop()
    const after = calls
    await flush(40)
    expect(calls).toBe(after)
  })
})
