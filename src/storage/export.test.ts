import { describe, expect, it } from 'vitest'
import { buildCsv, buildSessionJson, sessionFileBase, type PidResolver } from './export'
import type { SampleRow, SessionRow } from './db'

const samples: SampleRow[] = [
  { id: 1, sessionId: 1, ts: 1000, pidId: 'std.rpm', value: 850 },
  { id: 2, sessionId: 1, ts: 1100, pidId: 'std.rpm', value: 900 },
]

const resolver: PidResolver = (id) =>
  id === 'std.rpm' ? { name: 'Engine RPM', unit: 'rpm' } : undefined

describe('buildCsv', () => {
  it('builds long-format CSV with a header and one row per sample', () => {
    const lines = buildCsv(samples, resolver).split('\n')
    expect(lines[0]).toBe('iso_time,epoch_ms,pid_id,pid_name,unit,value')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('std.rpm')
    expect(lines[1]).toContain('Engine RPM')
    expect(lines[1]).toContain('850')
  })

  it('escapes fields containing commas', () => {
    const csv = buildCsv([{ id: 1, sessionId: 1, ts: 0, pidId: 'x', value: 1 }], () => ({
      name: 'temp, inlet',
      unit: '',
    }))
    expect(csv).toContain('"temp, inlet"')
  })

  it('falls back to the pid id when a PID is unresolved', () => {
    expect(buildCsv(samples, () => undefined)).toContain('std.rpm,std.rpm')
  })
})

describe('buildSessionJson', () => {
  it('embeds session metadata and compact samples', () => {
    const s: SessionRow = {
      id: 1,
      label: 'Drive',
      note: '',
      startedAt: 0,
      endedAt: 1000,
      transportKind: 'mock',
      pidIds: ['std.rpm'],
      sampleCount: 2,
    }
    const json = JSON.parse(buildSessionJson(s, samples))
    expect(json.session.label).toBe('Drive')
    expect(json.samples).toHaveLength(2)
    expect(json.samples[0]).toEqual({ ts: 1000, pidId: 'std.rpm', value: 850 })
  })
})

describe('sessionFileBase', () => {
  it('produces a filesystem-safe base name', () => {
    const s: SessionRow = {
      id: 1,
      label: 'My Drive!',
      note: '',
      startedAt: Date.parse('2026-07-11T10:00:00Z'),
      endedAt: null,
      transportKind: 'mock',
      pidIds: [],
      sampleCount: 0,
    }
    const base = sessionFileBase(s)
    expect(base).toMatch(/^obd-2026-07-11-10-00-00/)
    expect(base).toContain('My-Drive')
    expect(base).not.toContain('!')
  })
})
