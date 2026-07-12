import type { PidDefinition } from './types'

/**
 * EXPERIMENTAL Fiat Ducato DPF PIDs (Mode 22).
 *
 * ⚠️ These PID numbers and formulas are PLACEHOLDERS chosen to match the built-in
 * simulator. The real Fiat/FPT MultiJet Mode 22 PIDs vary by engine (2.0/2.3/3.0)
 * and Euro standard and MUST be verified on the vehicle by capturing raw responses
 * (see the Settings → PIDs view and the `obd-protocol` subagent workflow). Do not
 * trust these values on a real car until confirmed.
 */
export const FIAT_DPF_PIDS: readonly PidDefinition[] = [
  {
    id: 'fiat.dpf.soot',
    mode: 0x22,
    pid: 0x18f0,
    name: 'DPF soot load',
    shortName: 'DPF soot',
    unit: 'g/L',
    category: 'dpf',
    min: 0,
    max: 40,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : (a * 256 + b) / 10
    },
  },
  {
    id: 'fiat.dpf.egt',
    mode: 0x22,
    pid: 0x18f1,
    name: 'Exhaust gas temperature (DPF inlet)',
    shortName: 'Exhaust temp',
    unit: '°C',
    category: 'dpf',
    min: 0,
    max: 900,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : (a * 256 + b) / 10 - 40
    },
  },
  {
    id: 'fiat.dpf.regenActive',
    mode: 0x22,
    pid: 0x18f2,
    name: 'DPF regeneration active',
    shortName: 'Regenerating',
    unit: 'bool',
    category: 'dpf',
    min: 0,
    max: 1,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      return a === undefined ? null : a
    },
  },
  {
    id: 'fiat.dpf.kmSinceRegen',
    mode: 0x22,
    pid: 0x18f3,
    name: 'Distance since last regeneration',
    shortName: 'Since last regen',
    unit: 'km',
    category: 'dpf',
    min: 0,
    max: 65535,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : a * 256 + b
    },
  },
  {
    id: 'fiat.dpf.regenOk',
    mode: 0x22,
    pid: 0x18f4,
    name: 'Successful DPF regenerations',
    shortName: 'Regens OK',
    unit: '',
    category: 'dpf',
    min: 0,
    max: 65535,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : a * 256 + b
    },
  },
  {
    id: 'fiat.dpf.regenDisrupted',
    mode: 0x22,
    pid: 0x18f5,
    name: 'Disrupted DPF regenerations',
    shortName: 'Regens disrupted',
    unit: '',
    category: 'dpf',
    min: 0,
    max: 65535,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : a * 256 + b
    },
  },
  {
    id: 'fiat.dpf.regenRetried',
    mode: 0x22,
    pid: 0x18f6,
    name: 'Retried DPF regenerations',
    shortName: 'Regens retried',
    unit: '',
    category: 'dpf',
    min: 0,
    max: 65535,
    experimental: true,
    source: 'placeholder — verify on vehicle',
    decode: (d) => {
      const a = d[0]
      const b = d[1]
      return a === undefined || b === undefined ? null : a * 256 + b
    },
  },
]
