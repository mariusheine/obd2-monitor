import { describe, expect, it } from 'vitest'

import { MockTransport } from '../transport/MockTransport'
import { Elm327 } from '../elm327/Elm327'
import { diffDtcs, readActiveDtcs, type ActiveDtc } from './monitor'

const dtc = (over: Partial<ActiveDtc> & Pick<ActiveDtc, 'code' | 'status'>): ActiveDtc => ({
  system: 'powertrain',
  manufacturerSpecific: false,
  ...over,
})

describe('diffDtcs', () => {
  it('reports every code as appeared on the first poll (empty prev)', () => {
    const next = [dtc({ code: 'P2002', status: 'stored' }), dtc({ code: 'P2453', status: 'pending' })]
    const { appeared, cleared } = diffDtcs([], next)
    expect(appeared.map((d) => d.code)).toEqual(['P2002', 'P2453'])
    expect(cleared).toEqual([])
  })

  it('reports a newly-present code as appeared', () => {
    const prev = [dtc({ code: 'P2002', status: 'stored' })]
    const next = [dtc({ code: 'P2002', status: 'stored' }), dtc({ code: 'P2463', status: 'pending' })]
    const { appeared, cleared } = diffDtcs(prev, next)
    expect(appeared.map((d) => d.code)).toEqual(['P2463'])
    expect(cleared).toEqual([])
  })

  it('reports a vanished code as cleared', () => {
    const prev = [dtc({ code: 'P2463', status: 'pending' })]
    const { appeared, cleared } = diffDtcs(prev, [])
    expect(appeared).toEqual([])
    expect(cleared.map((d) => d.code)).toEqual(['P2463'])
  })

  it('treats the same code in different sets independently', () => {
    // A code maturing pending -> stored is a clear(pending) + appear(stored) pair.
    const prev = [dtc({ code: 'P2463', status: 'pending' })]
    const next = [dtc({ code: 'P2463', status: 'stored' })]
    const { appeared, cleared } = diffDtcs(prev, next)
    expect(appeared.map((d) => d.status)).toEqual(['stored'])
    expect(cleared.map((d) => d.status)).toEqual(['pending'])
  })

  it('reports nothing when the set is unchanged', () => {
    const set = [dtc({ code: 'P2002', status: 'stored' }), dtc({ code: 'P2453', status: 'pending' })]
    const { appeared, cleared } = diffDtcs(set, [...set])
    expect(appeared).toEqual([])
    expect(cleared).toEqual([])
  })
})

describe('readActiveDtcs', () => {
  it('reads the three sets from the simulator, tagging each with its status', async () => {
    const transport = new MockTransport(0)
    await transport.connect()
    const elm = new Elm327(transport)
    await elm.init()

    const active = await readActiveDtcs(elm)
    // The mock reports two stored codes (P2002, P0401) and at least the pending P2453.
    const stored = active.filter((d) => d.status === 'stored').map((d) => d.code)
    expect(stored).toEqual(expect.arrayContaining(['P2002', 'P0401']))
    expect(active.some((d) => d.status === 'pending' && d.code === 'P2453')).toBe(true)
    expect(active.every((d) => ['stored', 'pending', 'permanent'].includes(d.status))).toBe(true)
  })
})
