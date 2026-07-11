import { parseObdBytes } from '../elm327/parse'
import { ObdError } from '../elm327/types'
import { describeDtc } from './descriptions'

export type DtcSystem = 'powertrain' | 'chassis' | 'body' | 'network'

export interface Dtc {
  /** Standard 5-char code, e.g. `P2002`. */
  code: string
  system: DtcSystem
  /** True for manufacturer-defined codes (P1xxx etc.) not in the generic standard. */
  manufacturerSpecific: boolean
  /** Human-readable description if the code is a known generic one. */
  description?: string
}

const LETTERS: readonly string[] = ['P', 'C', 'B', 'U']
const SYSTEMS: readonly DtcSystem[] = ['powertrain', 'chassis', 'body', 'network']

/** Decode the two DTC bytes (per SAE J2012) into a code + metadata. */
export function decodeDtc(a: number, b: number): Dtc {
  const selector = (a >> 6) & 0x03
  const letter = LETTERS[selector] ?? 'P'
  const d1 = (a >> 4) & 0x03
  const d2 = a & 0x0f
  const d3 = (b >> 4) & 0x0f
  const d4 = b & 0x0f
  const code = `${letter}${d1}${d2.toString(16)}${d3.toString(16)}${d4.toString(16)}`.toUpperCase()
  return {
    code,
    system: SYSTEMS[selector] ?? 'powertrain',
    manufacturerSpecific: d1 === 1,
    description: describeDtc(code),
  }
}

/**
 * Parse a Mode 03 (stored), 07 (pending), or 0A (permanent) response into DTCs.
 *
 * Handles the CAN framing where a DTC count byte follows the mode byte (detected
 * by odd payload length), skips `0000` padding, and treats `NO DATA` (adapter's
 * way of saying "no codes") as an empty list.
 */
export function parseDtcResponse(raw: string, mode: number): Dtc[] {
  let bytes: number[]
  try {
    bytes = parseObdBytes(raw)
  } catch (err) {
    if (err instanceof ObdError && err.kind === 'no-data') return []
    throw err
  }

  const responseMode = mode + 0x40
  const idx = bytes.indexOf(responseMode)
  if (idx === -1) return []

  let payload = bytes.slice(idx + 1)
  // CAN responses prefix the DTCs with a count byte → odd payload length.
  if (payload.length % 2 === 1) payload = payload.slice(1)

  const dtcs: Dtc[] = []
  for (let i = 0; i + 1 < payload.length; i += 2) {
    const a = payload[i]
    const b = payload[i + 1]
    if (a === undefined || b === undefined) break
    if (a === 0 && b === 0) continue // padding / empty slot
    dtcs.push(decodeDtc(a, b))
  }
  return dtcs
}

export const SYSTEM_LABELS: Readonly<Record<DtcSystem, string>> = {
  powertrain: 'Powertrain',
  chassis: 'Chassis',
  body: 'Body',
  network: 'Network',
}
