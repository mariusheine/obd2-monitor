import { describe, expect, it } from 'vitest'
import { buildCommand, extractPidData, parseObdBytes } from './parse'
import { ObdError } from './types'

describe('buildCommand', () => {
  it('formats mode 01 PIDs with a 1-byte pid', () => {
    expect(buildCommand(0x01, 0x0c)).toBe('010C')
    expect(buildCommand(0x03, 0x00)).toBe('0300')
  })
  it('formats mode 22 PIDs with a 2-byte pid', () => {
    expect(buildCommand(0x22, 0x18f0)).toBe('2218F0')
  })
})

describe('parseObdBytes', () => {
  it('parses a space-separated single-frame response', () => {
    expect(parseObdBytes('41 0C 1A F8')).toEqual([0x41, 0x0c, 0x1a, 0xf8])
  })

  it('parses a response with no spaces (ATS0)', () => {
    expect(parseObdBytes('410C1AF8')).toEqual([0x41, 0x0c, 0x1a, 0xf8])
  })

  it('ignores SEARCHING... noise', () => {
    expect(parseObdBytes('SEARCHING...\r41 0D 32')).toEqual([0x41, 0x0d, 0x32])
  })

  it('reassembles ISO-TP multi-line frames', () => {
    const raw = '0: 62 18 F0 00 96 01\r1: 02 03 04 05 06 07'
    expect(parseObdBytes(raw)).toEqual([
      0x62, 0x18, 0xf0, 0x00, 0x96, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    ])
  })

  it('throws a typed error on NO DATA', () => {
    expect(() => parseObdBytes('NO DATA')).toThrow(ObdError)
    try {
      parseObdBytes('NO DATA')
    } catch (e) {
      expect((e as ObdError).kind).toBe('no-data')
    }
  })

  it('throws on unknown-command "?"', () => {
    try {
      parseObdBytes('?')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ObdError).kind).toBe('unknown-command')
    }
  })
})

describe('extractPidData', () => {
  it('strips the mode+pid echo for mode 01', () => {
    expect(extractPidData([0x41, 0x0c, 0x1a, 0xf8], 0x01, 0x0c)).toEqual([0x1a, 0xf8])
  })

  it('strips the 2-byte pid echo for mode 22', () => {
    expect(extractPidData([0x62, 0x18, 0xf0, 0x00, 0x96], 0x22, 0x18f0)).toEqual([0x00, 0x96])
  })

  it('throws when the positive-response mode is absent', () => {
    expect(() => extractPidData([0x7f, 0x01, 0x12], 0x01, 0x0c)).toThrow(ObdError)
  })
})
