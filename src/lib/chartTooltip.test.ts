import { describe, expect, it } from 'vitest'

import { TimeSeries } from './TimeSeries'
import {
  renderTooltipHtml,
  tooltipModelAt,
  type ChartMarker,
  type TooltipRenderOpts,
} from './chartTooltip'

function seriesOf(...points: [number, number][]): TimeSeries {
  const s = new TimeSeries()
  for (const [t, v] of points) s.push(t, v)
  return s
}

describe('tooltipModelAt', () => {
  it('returns the value and timestamp at the hovered index', () => {
    const s = seriesOf([1000, 10], [2000, 20])
    const model = tooltipModelAt(s, 1, undefined, 500)
    expect(model).toEqual({ ts: 2000, value: 20, events: [] })
  })

  it('returns null when the index has no sample', () => {
    const s = seriesOf([1000, 10])
    expect(tooltipModelAt(s, 5, undefined, 500)).toBeNull()
  })

  it('includes DTC markers within 2 PID intervals of the hovered sample', () => {
    const s = seriesOf([1000, 10], [2000, 20], [3000, 30])
    // Hovered sample ts = 2000, interval = 500 -> window is 2000 ± 1000ms.
    const markers: ChartMarker[] = [
      { ts: 2000, kind: 'appeared', code: 'P2002' }, // on the sample
      { ts: 2900, kind: 'cleared', code: 'P0401' }, // 900ms away — inside
      { ts: 3200, kind: 'appeared', code: 'P0299' }, // 1200ms away — outside
    ]
    const model = tooltipModelAt(s, 1, markers, 500)
    expect(model?.events.map((e) => e.code)).toEqual(['P2002', 'P0401'])
  })

  it('honors a custom interval count', () => {
    const s = seriesOf([1000, 10], [2000, 20])
    const markers: ChartMarker[] = [{ ts: 3500, kind: 'appeared', code: 'P0299' }]
    // ts=2000, interval=500 -> ±1000 excludes 3500; count=4 -> ±2000 includes it.
    expect(tooltipModelAt(s, 1, markers, 500)?.events).toHaveLength(0)
    expect(tooltipModelAt(s, 1, markers, 500, 4)?.events.map((e) => e.code)).toEqual(['P0299'])
  })
})

describe('renderTooltipHtml', () => {
  const opts: TooltipRenderOpts = {
    unit: 'rpm',
    color: '#3987e5',
    appearedColor: '#e5484d',
    clearedColor: '#30a46c',
    formatValue: (v) => v.toFixed(1),
    formatTime: () => '14:31:02',
  }

  it('renders the time, value and unit', () => {
    const html = renderTooltipHtml({ ts: 1000, value: 20, events: [] }, opts)
    expect(html).toContain('14:31:02')
    expect(html).toContain('20.0')
    expect(html).toContain('rpm')
  })

  it('renders a compact row per DTC event: color-coded dot + code only', () => {
    const html = renderTooltipHtml(
      {
        ts: 1000,
        value: 20,
        events: [{ ts: 1000, kind: 'appeared', code: 'P2002', description: 'DPF efficiency low' }],
      },
      opts,
    )
    expect(html).toContain('P2002')
    expect(html).toContain('#e5484d') // appeared marker color on the dot
    // The kind label and description are intentionally left out of the tooltip.
    expect(html).not.toContain('DPF efficiency low')
  })

  it('colors the dot green for a cleared code', () => {
    const html = renderTooltipHtml(
      { ts: 1000, value: 20, events: [{ ts: 1000, kind: 'cleared', code: 'P2002' }] },
      opts,
    )
    expect(html).toContain('#30a46c')
  })

  it('escapes HTML in the code', () => {
    const html = renderTooltipHtml(
      { ts: 1000, value: 20, events: [{ ts: 1000, kind: 'cleared', code: 'P<x>' }] },
      opts,
    )
    expect(html).toContain('P&lt;x&gt;')
    expect(html).not.toContain('P<x>')
  })
})
