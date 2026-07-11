import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GaugeDial from './GaugeDial.vue'

const LEN = Math.PI * 52

function filledLength(html: ReturnType<typeof mount>): number {
  const valueArc = html.findAll('path')[1]
  const dash = valueArc?.attributes('stroke-dasharray') ?? '0 0'
  return parseFloat(dash.split(' ')[0] ?? '0')
}

describe('GaugeDial', () => {
  it('renders the value and fills the arc proportionally', () => {
    const w = mount(GaugeDial, {
      props: { label: 'RPM', value: 50, unit: '%', min: 0, max: 100, color: '#3987e5' },
    })
    expect(w.text()).toContain('50')
    expect(w.findAll('path')).toHaveLength(2)
    expect(filledLength(w)).toBeCloseTo(0.5 * LEN, 1)
  })

  it('clamps out-of-range values to the arc ends', () => {
    const high = mount(GaugeDial, {
      props: { label: 'X', value: 200, unit: '', min: 0, max: 100, color: '#000' },
    })
    expect(filledLength(high)).toBeCloseTo(LEN, 1)
    const low = mount(GaugeDial, {
      props: { label: 'X', value: -50, unit: '', min: 0, max: 100, color: '#000' },
    })
    expect(filledLength(low)).toBeCloseTo(0, 1)
  })

  it('shows a dash when the value is undefined', () => {
    const w = mount(GaugeDial, { props: { label: 'X', unit: '', min: 0, max: 100, color: '#000' } })
    expect(w.text()).toContain('—')
    expect(filledLength(w)).toBe(0)
  })
})
