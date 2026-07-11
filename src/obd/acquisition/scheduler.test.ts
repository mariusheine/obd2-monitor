import { describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/MockTransport'
import { Elm327 } from '../elm327/Elm327'
import type { Sample } from '../pids/types'
import { AcquisitionScheduler, buildPollSpecs, defaultPollMs } from './scheduler'

async function connectedElm(): Promise<Elm327> {
  const transport = new MockTransport(0)
  await transport.connect()
  const elm = new Elm327(transport)
  await elm.init()
  return elm
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('buildPollSpecs / defaultPollMs', () => {
  it('assigns faster rates to fast-changing signals', () => {
    expect(defaultPollMs('engine')).toBeLessThan(defaultPollMs('temperature'))
    expect(defaultPollMs('speed')).toBeLessThan(defaultPollMs('electrical'))
  })

  it('drops unknown PID ids', () => {
    const specs = buildPollSpecs(['std.rpm', 'does.not.exist'])
    expect(specs).toHaveLength(1)
    expect(specs[0]?.pidId).toBe('std.rpm')
  })
})

describe('AcquisitionScheduler', () => {
  it('polls faster PIDs more often and decodes samples', async () => {
    const elm = await connectedElm()
    const samples: Sample[] = []
    const scheduler = new AcquisitionScheduler(elm, { onSample: (s) => samples.push(s) })
    scheduler.setPids([
      { pidId: 'std.rpm', intervalMs: 20 },
      { pidId: 'std.coolantTemp', intervalMs: 100 },
    ])
    scheduler.start()
    await wait(300)
    scheduler.stop()

    const rpm = samples.filter((s) => s.pidId === 'std.rpm')
    const coolant = samples.filter((s) => s.pidId === 'std.coolantTemp')
    expect(rpm.length).toBeGreaterThan(0)
    expect(coolant.length).toBeGreaterThan(0)
    expect(rpm.length).toBeGreaterThan(coolant.length)
    // Decoded values are physically plausible.
    expect(rpm.every((s) => s.value >= 700 && s.value <= 4300)).toBe(true)
  })

  it('stops issuing samples after stop()', async () => {
    const elm = await connectedElm()
    let count = 0
    const scheduler = new AcquisitionScheduler(elm, { onSample: () => (count += 1) })
    scheduler.setPids([{ pidId: 'std.rpm', intervalMs: 10 }])
    scheduler.start()
    await wait(80)
    scheduler.stop()
    const afterStop = count
    await wait(80)
    expect(count).toBe(afterStop)
  })
})
