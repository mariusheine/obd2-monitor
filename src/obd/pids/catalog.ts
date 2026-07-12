import { FIAT_DPF_PIDS } from './fiatDpf'
import { STANDARD_PIDS } from './standardPids'
import type { PidDefinition } from './types'

/** All built-in PID definitions (standard + experimental Fiat DPF). */
export const BUILTIN_PIDS: readonly PidDefinition[] = [...STANDARD_PIDS, ...FIAT_DPF_PIDS]

const byId = new Map<string, PidDefinition>(BUILTIN_PIDS.map((p) => [p.id, p]))
const byModePid = new Map<string, PidDefinition>(
  BUILTIN_PIDS.map((p) => [modePidKey(p.mode, p.pid), p]),
)

export function modePidKey(mode: number, pid: number): string {
  return `${mode}:${pid}`
}

export function getPid(id: string): PidDefinition | undefined {
  return byId.get(id)
}

export function findPidByModePid(mode: number, pid: number): PidDefinition | undefined {
  return byModePid.get(modePidKey(mode, pid))
}

/** Default set of PIDs the DPF dashboard preset polls. */
export const DPF_PRESET_IDS: readonly string[] = [
  'std.rpm',
  'std.speed',
  'std.coolantTemp',
  'std.engineLoad',
  'fiat.dpf.soot',
  'fiat.dpf.egt',
  'fiat.dpf.regenActive',
  'fiat.dpf.kmSinceRegen',
  'fiat.dpf.regenOk',
  'fiat.dpf.regenDisrupted',
  'fiat.dpf.regenRetried',
]
