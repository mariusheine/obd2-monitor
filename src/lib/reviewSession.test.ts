import { describe, expect, it } from 'vitest'

import type { CloudDtcEvent } from '@/obd/sync/cloudSessions'
import {
  activeDtcsAtEnd,
  buildReviewSeries,
  dtcEventsToMarkers,
  endStateSnapshot,
  type ReviewSample,
} from './reviewSession'

function sample(ts: number, pidId: string, value: number): ReviewSample {
  return { ts, pidId, value }
}

function dtc(ts: number, kind: CloudDtcEvent['kind'], code: string): CloudDtcEvent {
  return { ts, kind, code, status: 'stored', system: 'powertrain', manufacturerSpecific: false }
}

describe('buildReviewSeries', () => {
  it('groups samples by PID in time order', () => {
    const series = buildReviewSeries([
      sample(1000, 'std.rpm', 800),
      sample(1000, 'std.speed', 0),
      sample(2000, 'std.rpm', 1500),
      sample(2000, 'std.speed', 30),
    ])
    expect([...series.keys()].sort()).toEqual(['std.rpm', 'std.speed'])
    const rpm = series.get('std.rpm')!
    expect(rpm.ts).toEqual([1000, 2000])
    expect(rpm.values).toEqual([800, 1500])
  })

  it('sorts out-of-order samples within a PID', () => {
    const series = buildReviewSeries([
      sample(3000, 'std.rpm', 3),
      sample(1000, 'std.rpm', 1),
      sample(2000, 'std.rpm', 2),
    ])
    const rpm = series.get('std.rpm')!
    expect(rpm.ts).toEqual([1000, 2000, 3000])
    expect(rpm.values).toEqual([1, 2, 3])
  })

  it('keeps the whole series when under the cap (no live-default drop)', () => {
    const samples = Array.from({ length: 1200 }, (_, i) => sample(i, 'std.rpm', i))
    const rpm = buildReviewSeries(samples).get('std.rpm')!
    // Would be capped to 900 by the live TimeSeries default; review keeps all 1200.
    expect(rpm.length).toBe(1200)
    expect(rpm.values[0]).toBe(0)
    expect(rpm.values[rpm.length - 1]).toBe(1199)
  })

  it('decimates a long series to <= maxPoints, preserving first and last', () => {
    const samples = Array.from({ length: 10_000 }, (_, i) => sample(i, 'std.rpm', i))
    const rpm = buildReviewSeries(samples, 500).get('std.rpm')!
    expect(rpm.length).toBeLessThanOrEqual(500)
    expect(rpm.values[0]).toBe(0)
    expect(rpm.ts[0]).toBe(0)
    expect(rpm.values[rpm.length - 1]).toBe(9999)
    expect(rpm.ts[rpm.length - 1]).toBe(9999)
  })
})

describe('dtcEventsToMarkers', () => {
  it('maps events onto the chart-marker shape', () => {
    const markers = dtcEventsToMarkers([
      { ...dtc(5000, 'appeared', 'P2002'), description: 'DPF efficiency' },
    ])
    expect(markers).toEqual([
      { ts: 5000, kind: 'appeared', code: 'P2002', description: 'DPF efficiency' },
    ])
  })
})

describe('endStateSnapshot', () => {
  it('takes the last value seen per PID', () => {
    const snapshot = endStateSnapshot([
      sample(1000, 'fiat.dpf.soot', 10),
      sample(2000, 'fiat.dpf.soot', 22),
      sample(1500, 'fiat.dpf.egt', 400),
    ])
    expect(snapshot).toEqual({ 'fiat.dpf.soot': 22, 'fiat.dpf.egt': 400 })
  })
})

describe('activeDtcsAtEnd', () => {
  it('reports a code that appeared and never cleared', () => {
    const active = activeDtcsAtEnd([dtc(1000, 'appeared', 'P2002')])
    expect(active.map((d) => d.code)).toEqual(['P2002'])
  })

  it('drops a code that cleared after appearing', () => {
    const active = activeDtcsAtEnd([
      dtc(1000, 'appeared', 'P2002'),
      dtc(2000, 'cleared', 'P2002'),
    ])
    expect(active).toEqual([])
  })

  it('drops a code wiped by a manual clear', () => {
    const active = activeDtcsAtEnd([
      dtc(1000, 'appeared', 'P0401'),
      dtc(2000, 'manual-clear', 'P0401'),
    ])
    expect(active).toEqual([])
  })

  it('reconstructs regardless of event order and carries the code fields', () => {
    const active = activeDtcsAtEnd([
      dtc(3000, 'appeared', 'P2453'),
      dtc(1000, 'appeared', 'P2002'),
      dtc(2000, 'cleared', 'P2002'),
    ])
    expect(active).toEqual([
      { code: 'P2453', status: 'stored', system: 'powertrain', manufacturerSpecific: false, description: undefined },
    ])
  })
})
