import { ObdError } from './types'

/** Build an ELM327 OBD request string, e.g. (0x01, 0x0C) -> "010C", (0x22, 0x18F0) -> "2218F0". */
export function buildCommand(mode: number, pid: number): string {
  const modeHex = mode.toString(16).toUpperCase().padStart(2, '0')
  const pidWidth = mode === 0x22 ? 4 : 2
  const pidHex = pid.toString(16).toUpperCase().padStart(pidWidth, '0')
  return `${modeHex}${pidHex}`
}

function detectError(upperLine: string): void {
  if (upperLine.includes('NO DATA')) throw new ObdError('No data', 'no-data')
  if (upperLine.includes('UNABLE TO CONNECT')) {
    throw new ObdError('Unable to connect to vehicle', 'unable-to-connect')
  }
  if (upperLine.includes('BUS ERROR') || upperLine.includes('CAN ERROR')) {
    throw new ObdError('Bus error', 'bus-error')
  }
  if (upperLine === 'STOPPED') throw new ObdError('Stopped', 'stopped')
  if (upperLine === '?') throw new ObdError('Unknown command', 'unknown-command')
  if (upperLine === 'ERROR') throw new ObdError('Adapter error', 'error')
}

/**
 * Parse a raw ELM327 response into a flat list of bytes.
 *
 * Handles: whitespace on/off (ATS0/ATS1), `SEARCHING...` noise, ISO-TP multi-line
 * framing (lines prefixed with a frame index like `0:`), and adapter error tokens.
 * Throws {@link ObdError} for `NO DATA` and friends.
 */
export function parseObdBytes(raw: string): number[] {
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const dataLines: string[] = []
  for (const line of lines) {
    const upper = line.toUpperCase()
    if (upper.startsWith('SEARCHING')) continue
    detectError(upper)
    // Strip an ISO-TP frame-index prefix such as "0:" / "1:".
    dataLines.push(line.replace(/^[0-9A-Fa-f]+:\s*/, ''))
  }

  const hex = dataLines.join('').replace(/\s+/g, '').toUpperCase()
  if (hex.length === 0) throw new ObdError('Empty OBD response', 'malformed')
  if (hex.length % 2 !== 0) throw new ObdError(`Odd-length hex: "${hex}"`, 'malformed')

  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.slice(i, i + 2)
    const byte = parseInt(pair, 16)
    if (Number.isNaN(byte)) throw new ObdError(`Invalid hex byte "${pair}"`, 'malformed')
    bytes.push(byte)
  }
  return bytes
}

/**
 * Given the flat bytes of a response, validate the positive-response header
 * (`mode + 0x40`) and the echoed PID, and return only the payload data bytes.
 */
export function extractPidData(
  bytes: number[],
  mode: number,
  pid: number,
  pidWidth: 1 | 2 = mode === 0x22 ? 2 : 1,
): number[] {
  const responseMode = mode + 0x40
  const modeIdx = bytes.indexOf(responseMode)
  if (modeIdx === -1) {
    throw new ObdError(
      `Response did not contain expected mode 0x${responseMode.toString(16)}`,
      'malformed',
    )
  }
  const dataStart = modeIdx + 1 + pidWidth
  if (dataStart > bytes.length) throw new ObdError('Response too short for PID echo', 'malformed')

  // Validate the echoed PID so a response for a different PID isn't misdecoded.
  const echoed = bytes.slice(modeIdx + 1, dataStart)
  const expected = pidWidth === 2 ? [(pid >> 8) & 0xff, pid & 0xff] : [pid & 0xff]
  if (!echoed.every((b, i) => b === expected[i])) {
    throw new ObdError(`Echoed PID did not match request 0x${pid.toString(16)}`, 'malformed')
  }
  return bytes.slice(dataStart)
}
