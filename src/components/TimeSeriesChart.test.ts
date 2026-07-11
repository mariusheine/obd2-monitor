import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimeSeries } from '@/lib/TimeSeries'

// Mock uPlot so the component can be exercised without a real canvas.
interface MockChart {
  data: unknown[]
  setData: ReturnType<typeof vi.fn>
  setSize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}
const instances: MockChart[] = []
vi.mock('uplot', () => ({
  default: class {
    data: unknown[]
    setData = vi.fn((d: unknown[]) => {
      this.data = d
    })
    setSize = vi.fn()
    destroy = vi.fn()
    constructor(_opts: unknown, data: unknown[]) {
      this.data = data
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
      props: { series, revision: 0, label: 'RPM', unit: 'rpm', color: '#3987e5' },
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

  it('destroys the chart on unmount', () => {
    const w = mount(TimeSeriesChart, {
      props: { series: new TimeSeries(), revision: 0, label: 'X', unit: 'u', color: '#000' },
    })
    const chart = instances[0]!
    w.unmount()
    expect(chart.destroy).toHaveBeenCalled()
  })
})
