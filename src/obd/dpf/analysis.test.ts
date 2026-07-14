import { describe, expect, it } from 'vitest'

import type { ActiveDtc } from '@/obd/dtc/monitor'
import { analyseDpf, worstSeverity, type DpfFinding } from './analysis'

function byId(findings: DpfFinding[], id: string): DpfFinding | undefined {
  return findings.find((f) => f.id === id)
}

const dtc = (code: string): ActiveDtc => ({
  code,
  status: 'pending',
  system: 'powertrain',
  manufacturerSpecific: false,
})

describe('analyseDpf', () => {
  it('returns nothing before any DPF value has been read', () => {
    expect(analyseDpf({})).toEqual([])
  })

  it('bands soot load into ok / elevated / high / critical', () => {
    expect(byId(analyseDpf({ 'fiat.dpf.soot': 8 }), 'soot')?.severity).toBe('ok')
    expect(byId(analyseDpf({ 'fiat.dpf.soot': 18 }), 'soot')?.severity).toBe('info')
    expect(byId(analyseDpf({ 'fiat.dpf.soot': 26 }), 'soot')?.severity).toBe('warn')
    expect(byId(analyseDpf({ 'fiat.dpf.soot': 33 }), 'soot')?.severity).toBe('crit')
  })

  it('rounds the soot value passed to the message', () => {
    expect(byId(analyseDpf({ 'fiat.dpf.soot': 26.47 }), 'soot')?.params?.value).toBe(26.5)
  })

  it('reports an active regeneration', () => {
    expect(byId(analyseDpf({ 'fiat.dpf.regenActive': 1 }), 'regenActive')?.severity).toBe('info')
    expect(byId(analyseDpf({ 'fiat.dpf.regenActive': 0 }), 'regenActive')).toBeUndefined()
  })

  it('warns when regenerations are frequently disrupted (short-trip pattern)', () => {
    const f = byId(
      analyseDpf({
        'fiat.dpf.regenOk': 128,
        'fiat.dpf.regenDisrupted': 11,
        'fiat.dpf.regenRetried': 9,
      }),
      'regenHealth',
    )
    expect(f?.severity).toBe('warn')
    expect(f?.params).toEqual({ disrupted: 11, retried: 9 })
  })

  it('treats a clean regen record as healthy', () => {
    const f = byId(
      analyseDpf({ 'fiat.dpf.regenOk': 200, 'fiat.dpf.regenDisrupted': 0 }),
      'regenHealth',
    )
    expect(f?.severity).toBe('ok')
  })

  it('warns when overdue since the last regen', () => {
    expect(byId(analyseDpf({ 'fiat.dpf.kmSinceRegen': 120 }), 'kmSinceRegen')).toBeUndefined()
    expect(byId(analyseDpf({ 'fiat.dpf.kmSinceRegen': 340 }), 'kmSinceRegen')?.severity).toBe('warn')
  })

  it('warns on abnormally hot exhaust', () => {
    expect(byId(analyseDpf({ 'fiat.dpf.egt': 520 }), 'egt')).toBeUndefined()
    expect(byId(analyseDpf({ 'fiat.dpf.egt': 760 }), 'egt')?.severity).toBe('warn')
  })

  it('flags an active DPF-related trouble code and ranks it first', () => {
    const findings = analyseDpf({ 'fiat.dpf.soot': 8 }, [dtc('P2463')])
    expect(findings[0]?.id).toBe('dpfFault')
    expect(findings[0]?.severity).toBe('crit')
    expect(findings[0]?.params?.codes).toBe('P2463')
  })

  it('ignores unrelated trouble codes and de-duplicates DPF ones', () => {
    expect(byId(analyseDpf({}, [dtc('P0301')]), 'dpfFault')).toBeUndefined()
    const f = byId(analyseDpf({}, [dtc('P2002'), dtc('P2002'), dtc('P0401')]), 'dpfFault')
    expect(f?.params?.codes).toBe('P2002, P0401')
  })

  it('orders findings most-severe first', () => {
    const findings = analyseDpf(
      { 'fiat.dpf.soot': 8, 'fiat.dpf.kmSinceRegen': 400 },
      [dtc('P2463')],
    )
    const severities = findings.map((f) => f.severity)
    expect(severities).toEqual([...severities].sort((a, b) =>
      ({ crit: 3, warn: 2, info: 1, ok: 0 })[b] - ({ crit: 3, warn: 2, info: 1, ok: 0 })[a],
    ))
    expect(severities[0]).toBe('crit')
  })
})

describe('worstSeverity', () => {
  it('is ok for no findings', () => {
    expect(worstSeverity([])).toBe('ok')
  })

  it('picks the highest severity present', () => {
    expect(worstSeverity(analyseDpf({ 'fiat.dpf.soot': 33 }))).toBe('crit')
    expect(worstSeverity(analyseDpf({ 'fiat.dpf.soot': 8 }))).toBe('ok')
  })
})
