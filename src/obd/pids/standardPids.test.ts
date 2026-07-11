import { describe, expect, it } from 'vitest'
import { getPid } from './catalog'
import type { PidDefinition } from './types'

function pid(id: string): PidDefinition {
  const p = getPid(id)
  if (!p) throw new Error(`missing pid ${id}`)
  return p
}

describe('standard PID decoders', () => {
  it('decodes RPM from A/B bytes', () => {
    expect(pid('std.rpm').decode([0x1a, 0xf8])).toBe(1726)
    expect(pid('std.rpm').decode([0x0f, 0xa0])).toBe(1000)
  })

  it('decodes coolant temperature with the -40 offset', () => {
    expect(pid('std.coolantTemp').decode([0x5a])).toBe(50)
    expect(pid('std.coolantTemp').decode([0x28])).toBe(0)
  })

  it('decodes vehicle speed directly', () => {
    expect(pid('std.speed').decode([0x50])).toBe(80)
  })

  it('decodes engine load as a percentage', () => {
    expect(pid('std.engineLoad').decode([0xff])).toBe(100)
    expect(pid('std.engineLoad').decode([0x00])).toBe(0)
  })

  it('decodes control module voltage in volts', () => {
    expect(pid('std.moduleVoltage').decode([0x37, 0x0e])).toBeCloseTo(14.094, 3)
  })

  it('returns null when data bytes are missing', () => {
    expect(pid('std.rpm').decode([0x1a])).toBeNull()
    expect(pid('std.coolantTemp').decode([])).toBeNull()
  })
})

describe('experimental Fiat DPF PIDs', () => {
  it('are flagged experimental so the UI can warn', () => {
    expect(pid('fiat.dpf.soot').experimental).toBe(true)
    expect(pid('fiat.dpf.egt').experimental).toBe(true)
  })
})
