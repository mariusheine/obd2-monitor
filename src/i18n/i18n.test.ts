import 'fake-indexeddb/auto'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { router } from '@/router'
import ConnectView from '@/views/ConnectView.vue'
import DtcView from '@/views/DtcView.vue'
import LiveView from '@/views/LiveView.vue'
import SessionsView from '@/views/SessionsView.vue'
import { i18n, setLocale } from './index'
import { dtcDescription, pidDesc, pidName, pidShort } from './labels'

// uPlot touches matchMedia/canvas at import; stub it like the chart unit test.
vi.mock('uplot', () => ({
  default: class {
    setData = vi.fn()
    setSize = vi.fn()
    destroy = vi.fn()
  },
}))

afterEach(() => setLocale('en'))

function mountView(Comp: unknown): string {
  return mount(Comp as never, { global: { plugins: [createPinia(), router, i18n] } }).text()
}

describe('label helpers (dotted catalog ids / DTC codes)', () => {
  it('translates PID labels and falls back to the catalog for unknown ids', () => {
    setLocale('de')
    const rpm = { id: 'std.rpm', name: 'Engine RPM', shortName: 'RPM' }
    expect(pidName(rpm as never)).toBe('Motordrehzahl')
    expect(pidShort(rpm as never)).toBe('Drehzahl')
    const unknown = { id: 'std.doesNotExist', name: 'Some name', shortName: 'X' }
    expect(pidName(unknown as never)).toBe('Some name')
  })

  it('resolves plain-language PID descriptions, empty for unknown ids', () => {
    setLocale('de')
    const regen = { id: 'fiat.dpf.regenActive', name: 'x', shortName: 'y' }
    expect(pidDesc(regen as never)).toBe('Ob der DPF gerade aktiv den angesammelten Ruß abbrennt.')
    setLocale('en')
    expect(pidDesc(regen as never)).toBe(
      'Whether the DPF is actively burning off accumulated soot right now.',
    )
    const unknown = { id: 'std.doesNotExist', name: 'x', shortName: 'y' }
    expect(pidDesc(unknown as never)).toBe('')
  })

  it('renames the confusing DPF short labels away from bare "Regen"', () => {
    const regen = { id: 'fiat.dpf.regenActive', name: 'x', shortName: 'y' }
    setLocale('en')
    expect(pidShort(regen as never)).toBe('Regenerating')
    setLocale('de')
    expect(pidShort(regen as never)).toBe('Regeneration')
  })

  it('translates DTC descriptions with a graceful fallback', () => {
    setLocale('de')
    expect(dtcDescription('P2002')).toBe(
      'Dieselpartikelfilter-Wirkungsgrad unter Schwellwert (Bank 1)',
    )
    expect(dtcDescription('P9999', 'catalog text')).toBe('catalog text')
    expect(dtcDescription('P9999')).toBe('Keine generische Beschreibung verfügbar')
  })

  it('selects plural forms per locale', () => {
    setLocale('en')
    expect(i18n.global.t('dtc.codeCount', 1)).toBe('1 code')
    expect(i18n.global.t('dtc.codeCount', 5)).toBe('5 codes')
    setLocale('de')
    expect(i18n.global.t('dtc.codeCount', 3)).toBe('3 Codes')
  })
})

describe('views render German with no leaked i18n keys', () => {
  it('ConnectView (incl. <i18n-t> banners with a German compound word)', () => {
    setLocale('de')
    const text = mountView(ConnectView)
    expect(text).toContain('BLE-Adapter verbinden')
    expect(text).toContain('Simulator verwenden')
    expect(text).toContain('Getrennt')
    expect(text).toContain('Chrome auf Android')
    expect(text).toContain('Bluetooth-Low-Energy-ELM327-Adapter')
    expect(text).not.toMatch(/connect\.[a-zA-Z]/)
  })

  it('LiveView disconnected banner', () => {
    setLocale('de')
    const text = mountView(LiveView)
    expect(text).toContain('Nicht verbunden')
    expect(text).not.toMatch(/live\.[a-zA-Z]/)
  })

  it('DtcView disconnected banner', () => {
    setLocale('de')
    const text = mountView(DtcView)
    expect(text).toContain('Nicht verbunden')
    expect(text).not.toMatch(/dtc\.[a-zA-Z]/)
  })

  it('SessionsView empty state', async () => {
    setLocale('de')
    const w = mount(SessionsView, { global: { plugins: [createPinia(), router, i18n] } })
    await flushPromises()
    await nextTick()
    const text = w.text()
    expect(text).toContain('Noch keine aufgezeichneten Sitzungen')
    expect(text).not.toMatch(/sessions\.[a-zA-Z]/)
  })
})
