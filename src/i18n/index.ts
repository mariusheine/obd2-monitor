import { createI18n } from 'vue-i18n'

import de from './locales/de'
import en from './locales/en'

export type Locale = 'en' | 'de'

const STORAGE_KEY = 'obd.locale'

export const availableLocales: readonly { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
]

function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (stored === 'en' || stored === 'de') return stored
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en'
  return nav.startsWith('de') ? 'de' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, de },
})

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.global.locale.value
}

/** Switch the active locale, persist it, and update `<html lang>`. */
export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

// String-keyed accessors for use outside components (stores, dynamic catalog
// lookups). The global composer's `t`/`te` are strongly typed against the message
// schema; widen them here so dynamic keys (PID ids, DTC codes) type-check.
type Translate = (key: string, named?: Record<string, unknown>) => string
export const translate = i18n.global.t as unknown as Translate
export const exists = i18n.global.te as unknown as (key: string) => boolean
