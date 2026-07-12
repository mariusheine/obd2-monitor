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
    const w = mount(ValueCard, { props: { label: 'Regenerating', display: 'ON', highlight: true } })
    expect(w.text()).toContain('ON')
    expect(w.classes()).toContain('highlight')
  })

  it('reveals the name + description on tap and hides them again', async () => {
    const w = mount(ValueCard, {
      props: {
        label: 'Regenerating',
        display: 'ON',
        name: 'DPF regeneration active',
        description: 'Whether the DPF is actively burning off accumulated soot right now.',
      },
    })
    expect(w.text()).not.toContain('actively burning off')

    await w.trigger('click')
    expect(w.text()).toContain('DPF regeneration active')
    expect(w.text()).toContain('actively burning off')

    // Backdrop click dismisses the popover.
    await w.get('.info-backdrop').trigger('click')
    expect(w.text()).not.toContain('actively burning off')
  })
})
