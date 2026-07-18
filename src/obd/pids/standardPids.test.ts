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

describe('standard diesel/DPF PIDs (SAE J1979)', () => {
  it('decodes EGT bank 1 sensor 1 from bytes B,C (byte A is the support bitmap)', () => {
    // A=0x01 (sensor 1 supported), B,C = 0x13,0x88 -> (0x1388)/10 - 40 = 500 - 40 = 460 °C
    expect(pid('std.egt1').decode([0x01, 0x13, 0x88])).toBeCloseTo(460, 5)
  })

  it('returns null for EGT when the sensor-1 temperature bytes are absent', () => {
    expect(pid('std.egt1').decode([0x00])).toBeNull()
    expect(pid('std.egt1').decode([0x01, 0x13])).toBeNull()
  })

  it('decodes DPF temperature with scale 0.1 and offset -40 from bytes A,B', () => {
    // 0x1770 = 6000 -> 600.0 - 40 = 560 °C
    expect(pid('std.dpfTemp').decode([0x17, 0x70])).toBeCloseTo(560, 5)
    // Minimum encoding 0x0000 -> -40 °C
    expect(pid('std.dpfTemp').decode([0x00, 0x00])).toBe(-40)
  })

  it('exposes a source note so the decode origin is auditable', () => {
    expect(pid('std.egt1').source).toContain('0x78')
    expect(pid('std.dpfTemp').source).toContain('0x7C')
  })
})

describe('experimental Fiat DPF PIDs', () => {
  it('are flagged experimental so the UI can warn', () => {
    expect(pid('fiat.dpf.soot').experimental).toBe(true)
    expect(pid('fiat.dpf.egt').experimental).toBe(true)
  })
})
