import type { PidDefinition, PidCategory } from '@/obd/pids/types'

/**
 * Chart colors drawn from the data-viz skill's validated **dark** categorical
 * palette (each clears 3:1 on a dark surface). Charts here are single-series, so
 * colors are assigned per signal identity — no in-plot adjacency to validate.
 */
export const CHART_INK = {
  axis: '#9fb0c3',
  grid: '#263241',
  text: '#f4f7fb',
} as const

/**
 * Colors for the DTC event markers overlaid on live charts: a code that
 * appeared is drawn in red (a fault turned up), one that cleared in green (it
 * went away). Both clear 3:1 on the dark chart surface.
 */
export const CHART_MARKER = {
  appeared: '#e5484d', // red
  cleared: '#30a46c', // green
} as const

const BY_CATEGORY: Record<PidCategory, string> = {
  engine: '#3987e5', // blue
  speed: '#199e70', // aqua
  temperature: '#d95926', // orange
  pressure: '#9085e9', // violet
  fuel: '#008300', // green
  electrical: '#d55181', // magenta
  dpf: '#c98500', // yellow
  other: '#3987e5',
}

const BY_ID: Record<string, string> = {
  'std.rpm': '#3987e5',
  'std.speed': '#199e70',
  'std.coolantTemp': '#d95926',
  'std.engineLoad': '#9085e9',
  'std.moduleVoltage': '#d55181',
  'std.fuelLevel': '#008300',
  'fiat.dpf.soot': '#c98500',
  'fiat.dpf.egt': '#e66767', // red — heat
  'fiat.dpf.regenActive': '#d55181',
  'fiat.dpf.kmSinceRegen': '#3987e5',
}

export function pidColor(def: PidDefinition): string {
  return BY_ID[def.id] ?? BY_CATEGORY[def.category]
}
