import { describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/MockTransport'
import { Elm327 } from '../elm327/Elm327'
import { decodeDtc, parseDtcResponse } from './decode'
import { describeDtc } from './descriptions'

describe('decodeDtc', () => {
  it('decodes the letter, digits and system from the two bytes', () => {
    expect(decodeDtc(0x01, 0x33).code).toBe('P0133')
    expect(decodeDtc(0x20, 0x02).code).toBe('P2002')
    expect(decodeDtc(0xc1, 0x00).code).toBe('U0100')
    expect(decodeDtc(0x40, 0x35).code).toBe('C0035')
    expect(decodeDtc(0x90, 0x00).code).toBe('B1000')
  })

  it('maps the selector bits to the system', () => {
    expect(decodeDtc(0x01, 0x33).system).toBe('powertrain')
    expect(decodeDtc(0x40, 0x35).system).toBe('chassis')
    expect(decodeDtc(0x90, 0x00).system).toBe('body')
    expect(decodeDtc(0xc1, 0x00).system).toBe('network')
  })

  it('flags manufacturer-specific (P1xxx) codes', () => {
    expect(decodeDtc(0x90, 0x00).manufacturerSpecific).toBe(true) // B1000
    expect(decodeDtc(0x20, 0x02).manufacturerSpecific).toBe(false) // P2002
  })

  it('attaches a description for known generic codes', () => {
    expect(decodeDtc(0x20, 0x02).description).toMatch(/Particulate/)
  })
})

describe('parseDtcResponse', () => {
  it('parses a CAN response with a leading count byte', () => {
    const dtcs = parseDtcResponse('43 02 20 02 04 01', 0x03)
    expect(dtcs.map((d) => d.code)).toEqual(['P2002', 'P0401'])
  })

  it('parses a non-CAN response and skips 0000 padding', () => {
    const dtcs = parseDtcResponse('43 01 33 00 00', 0x03)
    expect(dtcs.map((d) => d.code)).toEqual(['P0133'])
  })

  it('returns an empty list for no codes and for NO DATA', () => {
    expect(parseDtcResponse('43 00', 0x03)).toEqual([])
    expect(parseDtcResponse('NO DATA', 0x03)).toEqual([])
  })

  it('parses pending (07) and permanent (0A) modes', () => {
    expect(parseDtcResponse('47 01 24 53', 0x07).map((d) => d.code)).toEqual(['P2453'])
    expect(parseDtcResponse('4A 00', 0x0a)).toEqual([])
  })
})

describe('describeDtc', () => {
  it('resolves common diesel/DPF codes', () => {
    expect(describeDtc('P2002')).toMatch(/Particulate/)
    expect(describeDtc('P0401')).toMatch(/Recirculation/)
    expect(describeDtc('p0299')).toMatch(/underboost/i)
  })
  it('returns undefined for unknown codes', () => {
    expect(describeDtc('P1234')).toBeUndefined()
  })
})

describe('DTC read/clear over MockTransport', () => {
  it('reads stored + pending codes and clears them with Mode 04', async () => {
    const transport = new MockTransport(0)
    await transport.connect()
    const elm = new Elm327(transport)
    await elm.init()

    expect(parseDtcResponse(await elm.send('03'), 0x03).map((d) => d.code)).toEqual([
      'P2002',
      'P0401',
    ])
    expect(parseDtcResponse(await elm.send('07'), 0x07).map((d) => d.code)).toEqual(['P2453'])

    await elm.send('04')

    expect(parseDtcResponse(await elm.send('03'), 0x03)).toEqual([])
    expect(parseDtcResponse(await elm.send('07'), 0x07)).toEqual([])
  })
})
