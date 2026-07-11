import { describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/MockTransport'
import { getPid } from '../pids/catalog'
import { Elm327 } from './Elm327'

async function connectedElm(): Promise<{ elm: Elm327; transport: MockTransport }> {
  const transport = new MockTransport(0)
  await transport.connect()
  const elm = new Elm327(transport)
  await elm.init()
  return { elm, transport }
}

describe('Elm327 over MockTransport', () => {
  it('runs the init sequence without throwing', async () => {
    const { elm } = await connectedElm()
    // A follow-up command still works, proving the queue drained cleanly.
    const rv = await elm.send('ATRV')
    expect(rv).toContain('V')
  })

  it('queries a standard PID end-to-end and decodes it', async () => {
    const { elm } = await connectedElm()
    const res = await elm.query(0x01, 0x0c)
    expect(res.mode).toBe(0x01)
    expect(res.pid).toBe(0x0c)
    const rpm = getPid('std.rpm')?.decode(res.data)
    expect(rpm).not.toBeNull()
    expect(rpm!).toBeGreaterThan(700)
    expect(rpm!).toBeLessThan(4300)
  })

  it('queries an experimental Mode 22 DPF PID end-to-end', async () => {
    const { elm } = await connectedElm()
    const res = await elm.query(0x22, 0x18f0)
    const soot = getPid('fiat.dpf.soot')?.decode(res.data)
    expect(soot).not.toBeNull()
    expect(soot!).toBeGreaterThanOrEqual(0)
    expect(soot!).toBeLessThanOrEqual(40)
  })

  it('serialises concurrent commands', async () => {
    const { elm } = await connectedElm()
    const [a, b] = await Promise.all([elm.query(0x01, 0x0d), elm.query(0x01, 0x05)])
    expect(a.pid).toBe(0x0d)
    expect(b.pid).toBe(0x05)
  })
})
