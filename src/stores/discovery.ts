import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
  MAX_PROBE_COUNT,
  probePid,
  probeRange,
  scanSupportedMode01,
  type ProbeResult,
} from '@/obd/acquisition/discovery'
import { translate } from '@/i18n'
import { useConnectionStore } from './connection'
import { useLiveStore } from './live'

/** A single entry in the exportable capture log. */
export interface CaptureEntry {
  command: string
  raw: string
  at: number
}

/**
 * Drives the PID Discovery view: scans which Mode 01 PIDs the connected ECU
 * supports and probes manufacturer-specific ranges (e.g. Fiat DPF Mode 22), keeping
 * a raw capture log that can be exported and shared to pin down real PID formulas.
 *
 * Every adapter call goes through the shared {@link Elm327} queue, so scans are
 * serialised safely against the live poller — but we still pause polling during a
 * run so the probe isn't slowed by interleaved poll commands.
 */
export const useDiscoveryStore = defineStore('discovery', () => {
  const running = ref(false)
  const cancelRequested = ref(false)
  const error = ref<string | null>(null)

  const supportedMode01 = ref<number[]>([])
  const mode22Hits = shallowRef<ProbeResult[]>([])
  const log = ref<CaptureEntry[]>([])
  const progress = ref<{ done: number; total: number } | null>(null)

  const hasResults = computed(
    () => supportedMode01.value.length > 0 || mode22Hits.value.length > 0 || log.value.length > 0,
  )

  function record(command: string, raw: string): void {
    log.value.push({ command, raw, at: Date.now() })
  }

  function requireElm() {
    const elm = useConnectionStore().elm
    if (!elm) throw new Error(translate('discovery.notConnectedErr'))
    return elm
  }

  /** Run `body` with polling paused, guarding the single-run invariant. */
  async function withRun<T>(body: () => Promise<T>): Promise<T | undefined> {
    if (running.value) return undefined
    running.value = true
    cancelRequested.value = false
    error.value = null
    const live = useLiveStore()
    const wasPolling = live.polling
    if (wasPolling) live.stop()
    try {
      return await body()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return undefined
    } finally {
      const elm = useConnectionStore().elm
      if (wasPolling && elm) live.resume(elm)
      running.value = false
      progress.value = null
    }
  }

  /** Read the Mode 01 support bitmaps and list every supported standard PID. */
  async function scanMode01(): Promise<void> {
    await withRun(async () => {
      const elm = requireElm()
      const result = await scanSupportedMode01(elm)
      supportedMode01.value = result.supported
      for (const range of result.ranges) {
        record(`01${range.base.toString(16).toUpperCase().padStart(2, '0')}`, range.raw)
      }
    })
  }

  /**
   * Probe an inclusive PID range for a mode (default Mode 22) and collect the PIDs
   * that answer with data. Cancellable via {@link cancel}.
   */
  async function probe(mode: number, start: number, end: number): Promise<void> {
    await withRun(async () => {
      const elm = requireElm()
      const last = Math.min(end, start + MAX_PROBE_COUNT - 1)
      const total = Math.max(0, last - start + 1)
      progress.value = { done: 0, total }
      const hits = await probeRange(elm, mode, start, end, {
        shouldStop: () => cancelRequested.value,
        onResult: (result) => {
          progress.value = { done: (progress.value?.done ?? 0) + 1, total }
          record(commandFor(result), result.raw)
        },
      })
      // Merge with any prior hits, de-duplicating by mode:pid (last wins).
      const byKey = new Map(mode22Hits.value.map((h) => [`${h.mode}:${h.pid}`, h]))
      for (const h of hits) byKey.set(`${h.mode}:${h.pid}`, h)
      mode22Hits.value = [...byKey.values()].sort((a, b) => a.pid - b.pid)
    })
  }

  /** Send a single arbitrary command (PID probe or raw AT command) and log it. */
  async function sendRaw(command: string): Promise<ProbeResult | string | undefined> {
    return withRun(async () => {
      const elm = requireElm()
      const cmd = command.trim().toUpperCase()
      if (cmd.startsWith('AT')) {
        const raw = await elm.send(cmd)
        record(cmd, raw.trim())
        return raw.trim()
      }
      const hex = cmd.replace(/\s+/g, '')
      const mode = parseInt(hex.slice(0, 2), 16)
      const isMode22 = hex.slice(0, 2) === '22'
      const pid = parseInt(isMode22 ? hex.slice(2, 6) : hex.slice(2, 4), 16)
      if (Number.isNaN(mode) || Number.isNaN(pid)) throw new Error(translate('discovery.badCommand'))
      const result = await probePid(elm, mode, pid)
      record(commandFor(result), result.raw)
      return result
    })
  }

  function cancel(): void {
    cancelRequested.value = true
  }

  function clear(): void {
    supportedMode01.value = []
    mode22Hits.value = []
    log.value = []
    error.value = null
  }

  /** Build a plain-text capture bundle for sharing (matches what got sent + returned). */
  function exportText(): string {
    const lines: string[] = [
      '# OBD-II PID discovery capture',
      `# ${new Date().toISOString()}`,
      `# adapter: ${useConnectionStore().label ?? 'unknown'}`,
      `# protocol: ${useConnectionStore().protocol ?? 'unknown'}`,
      '',
      `# Supported Mode 01 PIDs: ${supportedMode01.value.map(toHex2).join(' ') || '(none scanned)'}`,
      '',
      '# command -> raw response',
    ]
    for (const entry of log.value) lines.push(`${entry.command}\t${entry.raw}`)
    return lines.join('\n')
  }

  return {
    running,
    error,
    supportedMode01,
    mode22Hits,
    log,
    progress,
    hasResults,
    scanMode01,
    probe,
    sendRaw,
    cancel,
    clear,
    exportText,
  }
})

function toHex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0')
}

function commandFor(result: ProbeResult): string {
  const modeHex = toHex2(result.mode)
  const pidHex = result.mode === 0x22 ? result.pid.toString(16).toUpperCase().padStart(4, '0') : toHex2(result.pid)
  return `${modeHex}${pidHex}`
}
