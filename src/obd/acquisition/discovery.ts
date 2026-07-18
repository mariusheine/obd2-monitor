import type { Elm327 } from '../elm327/Elm327'
import { buildCommand, extractPidData, parseObdBytes } from '../elm327/parse'

/**
 * PID discovery helpers — used by the Discovery view to find out what a *real* ECU
 * actually supports, so manufacturer-specific (e.g. Fiat DPF Mode 22) PIDs can be
 * pinned down from captured responses instead of guessed.
 *
 * These functions are pure request/response logic over an {@link Elm327}; the
 * bitmap decoding is unit-tested with hex fixtures.
 */

/** Mode 01 "supported PIDs" query PIDs, each covering the next 0x20-wide range. */
export const SUPPORT_PID_BASES: readonly number[] = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0]

/**
 * Decode a 4-byte Mode 01 support bitmap (the payload of PID 0x00/0x20/…) into the
 * list of PID numbers it advertises as supported. Bit A7 → `base+1`, A6 → `base+2`,
 * …, D0 → `base+0x20` (MSB-first). Missing trailing bytes are treated as 0.
 */
export function decodeSupportBitmap(base: number, data: readonly number[]): number[] {
  const pids: number[] = []
  for (let i = 0; i < 32; i++) {
    const byte = data[i >> 3]
    if (byte === undefined) break
    if ((byte & (0x80 >> (i & 7))) !== 0) pids.push(base + i + 1)
  }
  return pids
}

/** One 0x20-range's raw support response, kept for the exportable capture log. */
export interface SupportRange {
  base: number
  raw: string
}

export interface Mode01ScanResult {
  /** Supported *data* PIDs (the 0x20-range continuation markers are excluded). */
  supported: number[]
  /** Raw responses per range, for the capture log / export. */
  ranges: SupportRange[]
}

/**
 * Walk the Mode 01 support bitmaps (0x00 → 0x20 → …), following each range's
 * "next range supported" marker bit, and return every supported data PID.
 */
export async function scanSupportedMode01(elm: Elm327): Promise<Mode01ScanResult> {
  const supported: number[] = []
  const ranges: SupportRange[] = []
  for (const base of SUPPORT_PID_BASES) {
    let res
    try {
      res = await elm.query(0x01, base)
    } catch {
      break // this range's support PID isn't answered → nothing further to walk
    }
    ranges.push({ base, raw: res.raw.trim() })
    const nextMarker = base + 0x20
    const advertised = decodeSupportBitmap(base, res.data)
    for (const pid of advertised) if (pid !== nextMarker) supported.push(pid)
    if (!advertised.includes(nextMarker)) break // no further ranges advertised
  }
  return { supported, ranges }
}

/** Result of probing a single PID with a raw request. */
export interface ProbeResult {
  mode: number
  pid: number
  /** True when the ECU returned a positive response with payload bytes. */
  ok: boolean
  /** Raw adapter text, always captured (even on NO DATA / errors) for the log. */
  raw: string
  /** Payload data bytes on success. */
  data?: number[]
  /** Error/decoded reason on failure (e.g. "No data"). */
  error?: string
}

/**
 * Probe one PID with a raw request and always capture the raw response, decoding
 * the payload when it's a positive response. Never throws for a NO DATA / negative
 * response — that's a normal "unsupported" result — only a transport/timeout
 * failure rejects.
 */
export async function probePid(elm: Elm327, mode: number, pid: number): Promise<ProbeResult> {
  const raw = await elm.send(buildCommand(mode, pid))
  try {
    const bytes = parseObdBytes(raw)
    const data = extractPidData(bytes, mode, pid)
    return { mode, pid, ok: true, raw: raw.trim(), data }
  } catch (err) {
    return { mode, pid, ok: false, raw: raw.trim(), error: err instanceof Error ? err.message : String(err) }
  }
}

/** Inclusive [start, end] with a hard cap so a fat-fingered range can't hammer the bus forever. */
export const MAX_PROBE_COUNT = 1024

export interface ProbeRangeOptions {
  /** Called after each probe, e.g. to update progress / stream results into the UI. */
  onResult?: (result: ProbeResult) => void
  /** Return true to stop early (user pressed cancel). Checked before each probe. */
  shouldStop?: () => boolean
}

/**
 * Probe an inclusive PID range for a mode (typically Mode 22 for Fiat DPF DIDs),
 * returning only the PIDs that answered with data. `raw`/`error` for every probe is
 * still delivered via {@link ProbeRangeOptions.onResult} for the capture log.
 */
export async function probeRange(
  elm: Elm327,
  mode: number,
  start: number,
  end: number,
  opts: ProbeRangeOptions = {},
): Promise<ProbeResult[]> {
  const hits: ProbeResult[] = []
  const last = Math.min(end, start + MAX_PROBE_COUNT - 1)
  for (let pid = start; pid <= last; pid++) {
    if (opts.shouldStop?.()) break
    const result = await probePid(elm, mode, pid)
    opts.onResult?.(result)
    if (result.ok) hits.push(result)
  }
  return hits
}
