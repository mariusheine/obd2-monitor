import type { Elm327 } from '../elm327/Elm327'
import type { DtcStatus } from '@/storage/db'
import { parseDtcResponse, type DtcSystem } from './decode'

/** A trouble code currently present in one of the DTC sets, at a point in time. */
export interface ActiveDtc {
  code: string
  status: DtcStatus
  system: DtcSystem
  manufacturerSpecific: boolean
  description?: string
}

/** The three DTC sets and the request command that reads each. */
const DTC_SETS: readonly [command: string, mode: number, status: DtcStatus][] = [
  ['03', 0x03, 'stored'],
  ['07', 0x07, 'pending'],
  ['0A', 0x0a, 'permanent'],
]

/**
 * Read the stored (03), pending (07), and permanent (0A) codes into one flat
 * list tagging each with the set it came from. Reuses the same raw `send` +
 * {@link parseDtcResponse} path as the manual DTC read, so `NO DATA`, the CAN
 * count byte, and padding are all handled. Reads are serialised by
 * {@link Elm327.send}, so this interleaves safely with live PID polling.
 */
export async function readActiveDtcs(elm: Elm327): Promise<ActiveDtc[]> {
  const out: ActiveDtc[] = []
  for (const [command, mode, status] of DTC_SETS) {
    for (const d of parseDtcResponse(await elm.send(command), mode)) {
      out.push({
        code: d.code,
        status,
        system: d.system,
        manufacturerSpecific: d.manufacturerSpecific,
        description: d.description,
      })
    }
  }
  return out
}

/** Identity of a code within its set — a code can legitimately be in more than one set. */
function key(d: ActiveDtc): string {
  return `${d.status}:${d.code}`
}

/**
 * Compare the previous active set against a fresh read and report the state
 * changes: codes in `next` but not `prev` `appeared`; codes in `prev` but not
 * `next` `cleared`. On the first poll of a drive `prev` is empty, so every code
 * already present is reported as `appeared`. A code maturing pending→stored
 * shows up as `cleared(pending)` + `appeared(stored)`, which is faithful.
 */
export function diffDtcs(
  prev: readonly ActiveDtc[],
  next: readonly ActiveDtc[],
): { appeared: ActiveDtc[]; cleared: ActiveDtc[] } {
  const prevKeys = new Set(prev.map(key))
  const nextKeys = new Set(next.map(key))
  return {
    appeared: next.filter((d) => !prevKeys.has(key(d))),
    cleared: prev.filter((d) => !nextKeys.has(key(d))),
  }
}
