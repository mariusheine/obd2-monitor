import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { TimeSeries } from '@/lib/TimeSeries'

const global = { plugins: [i18n] }

// Mock uPlot so the component can be exercised without a real canvas.
interface MockHooks {
  draw: (u: unknown) => void
  init?: (u: unknown) => void
  setCursor?: (u: unknown) => void
}
interface MockChart {
  data: unknown[]
  opts: { plugins?: { hooks: MockHooks }[] }
  setData: ReturnType<typeof vi.fn>
  setSize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}
const instances: MockChart[] = []
vi.mock('uplot', () => ({
  default: class {
    data: unknown[]
    opts: unknown
    setData = vi.fn((d: unknown[]) => {
      this.data = d
    })
    setSize = vi.fn()
    destroy = vi.fn()
    constructor(opts: unknown, data: unknown[]) {
      this.data = data
      this.opts = opts
      instances.push(this as unknown as MockChart)
    }
  },
}))

import TimeSeriesChart from './TimeSeriesChart.vue'

beforeEach(() => {
  instances.length = 0
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
})

describe('TimeSeriesChart', () => {
  it('creates a chart with initial data (x in seconds) and redraws on revision bump', async () => {
    const series = new TimeSeries()
    series.push(1000, 10)
    series.push(2000, 20)

    const w = mount(TimeSeriesChart, {
      props: { series, revision: 0, label: 'RPM', unit: 'rpm', color: '#3987e5', intervalMs: 500 },
      global,
    })

    expect(instances).toHaveLength(1)
    const chart = instances[0]!
    expect(chart.data[0]).toEqual([1, 2])
    expect(chart.data[1]).toEqual([10, 20])
    expect(w.text()).toContain('20.0 rpm')

    // A new sample + revision bump should trigger setData with the new point.
    series.push(3000, 30)
    await w.setProps({ revision: 1 })
    expect(chart.setData).toHaveBeenCalled()
    const lastData = chart.setData.mock.calls.at(-1)?.[0] as number[][]
    expect(lastData[0]).toEqual([1, 2, 3])
    expect(w.text()).toContain('30.0 rpm')
  })

  it('draws a vertical marker for each in-window DTC event and skips out-of-range ones', () => {
    const series = new TimeSeries()
    series.push(1000, 10)
    series.push(5000, 20)

    mount(TimeSeriesChart, {
      props: {
        series,
        revision: 0,
        label: 'RPM',
        unit: 'rpm',
        color: '#3987e5',
        intervalMs: 500,
        markers: [
          { ts: 2000, kind: 'appeared', code: 'P2002' },
          { ts: 4000, kind: 'cleared', code: 'P2002' },
          { ts: 99000, kind: 'appeared', code: 'P0401' }, // outside the visible window
        ],
      },
      global,
    })

    const draw = instances[0]!.opts.plugins?.[0]?.hooks.draw
    expect(draw).toBeTypeOf('function')

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      setLineDash: vi.fn(),
    }
    const u = {
      ctx,
      bbox: { left: 0, top: 0, width: 100, height: 50 },
      scales: { x: { min: 1, max: 5 } }, // seconds
      pxRatio: 1,
      valToPos: (v: number) => ((v - 1) / (5 - 1)) * 100,
    }
    draw!(u)

    // Two markers fall inside [1s, 5s]; the P0401 at 99s is skipped.
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.fillText).toHaveBeenCalledTimes(2)
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['P2002', 'P2002'])
  })

  it('shows the value and any nearby DTC event on hover, and hides off-plot', () => {
    const series = new TimeSeries()
    series.push(1000, 10)
    series.push(2000, 20)

    mount(TimeSeriesChart, {
      props: {
        series,
        revision: 0,
        label: 'RPM',
        unit: 'rpm',
        color: '#3987e5',
        intervalMs: 500,
        markers: [{ ts: 2000, kind: 'appeared', code: 'P2002', description: 'DPF efficiency low' }],
      },
      global,
    })

    const hooks = instances[0]!.opts.plugins?.[0]?.hooks
    const over = document.createElement('div')
    // Cursor sits on sample idx 1 (ts 2000ms); the marker at 2000ms is within 2×500ms.
    const u = { over, cursor: { idx: 1, left: 2, top: 10 } }

    hooks!.init!(u)
    const tip = over.querySelector<HTMLElement>('.chart-tooltip')!
    expect(tip).not.toBeNull()

    hooks!.setCursor!(u)
    expect(tip.style.display).toBe('block')
    expect(tip.innerHTML).toContain('20.0')
    expect(tip.innerHTML).toContain('rpm')
    expect(tip.innerHTML).toContain('P2002')
    // The tooltip keeps DTC rows compact: code only, no description.
    expect(tip.innerHTML).not.toContain('DPF efficiency low')

    // Cursor off the plot hides the tooltip.
    hooks!.setCursor!({ ...u, cursor: { idx: null, left: -10, top: -10 } })
    expect(tip.style.display).toBe('none')
  })

  it('destroys the chart on unmount', () => {
    const w = mount(TimeSeriesChart, {
      props: { series: new TimeSeries(), revision: 0, label: 'X', unit: 'u', color: '#000', intervalMs: 500 },
      global,
    })
    const chart = instances[0]!
    w.unmount()
    expect(chart.destroy).toHaveBeenCalled()
  })
})
