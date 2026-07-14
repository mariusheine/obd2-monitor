import type { DtcSystem } from '@/obd/dtc/decode'
import type { PidDefinition } from '@/obd/pids/types'
import type { DtcEventKind } from '@/storage/db'

import { exists, translate } from './index'

/**
 * Translate catalog-driven labels by id/code. These read the reactive global
 * locale, so calling them inside a component template/computed re-renders on a
 * language switch. Unknown ids fall back to the English name in the catalog.
 */

// vue-i18n splits keys on '.', so PID ids like `std.rpm` must be escaped to a
// single path segment (`std_rpm`) to match the flat `pids.*` message keys.
const pidKey = (id: string): string => `pids.${id.replace(/\./g, '_')}`

export function pidName(pid: PidDefinition): string {
  const key = `${pidKey(pid.id)}.name`
  return exists(key) ? translate(key) : pid.name
}

export function pidShort(pid: PidDefinition): string {
  const key = `${pidKey(pid.id)}.short`
  return exists(key) ? translate(key) : pid.shortName
}

export function pidDesc(pid: PidDefinition): string {
  const key = `${pidKey(pid.id)}.desc`
  return exists(key) ? translate(key) : ''
}

export function dtcDescription(code: string, fallback?: string): string {
  const key = `dtcDesc.${code.toUpperCase()}`
  if (exists(key)) return translate(key)
  return fallback ?? translate('dtc.noDescription')
}

export function dtcSystemLabel(system: DtcSystem): string {
  return translate(`dtcSystem.${system}`)
}

const DTC_EVENT_ICON: Record<DtcEventKind, string> = {
  appeared: '⚠',
  cleared: '✓',
  'manual-clear': '🧹',
}
const DTC_EVENT_KEY: Record<DtcEventKind, string> = {
  appeared: 'dtc.eventAppeared',
  cleared: 'dtc.eventCleared',
  'manual-clear': 'dtc.eventManualCleared',
}

export function dtcEventIcon(kind: DtcEventKind): string {
  return DTC_EVENT_ICON[kind]
}

export function dtcEventLabel(kind: DtcEventKind): string {
  return translate(DTC_EVENT_KEY[kind])
}
