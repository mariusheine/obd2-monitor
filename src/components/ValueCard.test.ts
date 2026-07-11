import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ValueCard from './ValueCard.vue'

describe('ValueCard', () => {
  it('renders a value with its unit', () => {
    const w = mount(ValueCard, { props: { label: 'Soot', display: '12.3', unit: 'g/L' } })
    expect(w.text()).toContain('12.3')
    expect(w.text()).toContain('g/L')
  })

  it('marks experimental PIDs', () => {
    const w = mount(ValueCard, {
      props: { label: 'Soot', display: '12.3', unit: 'g/L', experimental: true },
    })
    expect(w.classes()).toContain('experimental')
  })

  it('highlights an active boolean state', () => {
    const w = mount(ValueCard, { props: { label: 'Regen', display: 'ON', highlight: true } })
    expect(w.text()).toContain('ON')
    expect(w.classes()).toContain('highlight')
  })
})
