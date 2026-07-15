import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { translate } from '@/i18n'
import { BleTransport } from '@/obd/transport/BleTransport'
import { MockTransport } from '@/obd/transport/MockTransport'
import { Reconnector } from '@/obd/transport/Reconnector'
import { Elm327 } from '@/obd/elm327/Elm327'
import type { Transport } from '@/obd/transport/types'
import { useConfigStore } from './config'
import { useLiveStore } from './live'

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type TransportKind = 'ble' | 'mock'

// Standard protocol identifiers (SAE/ISO names are not translated). '0' (auto)
// and the unknown fallback are localized via i18n.
const PROTOCOL_NAMES: Record<string, string> = {
  '1': 'SAE J1850 PWM',
  '2': 'SAE J1850 VPW',
  '3': 'ISO 9141-2',
  '4': 'ISO 14230-4 KWP (5 baud)',
  '5': 'ISO 14230-4 KWP (fast)',
  '6': 'ISO 15765-4 CAN (11/500)',
  '7': 'ISO 15765-4 CAN (29/500)',
  '8': 'ISO 15765-4 CAN (11/250)',
  '9': 'ISO 15765-4 CAN (29/250)',
}

function describeProtocol(dpn: string): string {
  const key = dpn.trim().replace(/^A/i, '') // 'A6' => auto-selected protocol 6
  if (key === '0') return translate('protocol.automatic')
  return PROTOCOL_NAMES[key] ?? translate('protocol.fallback', { dpn: dpn.trim() })
}

export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ConnStatus>('disconnected')
  const label = ref<string | null>(null)
  const protocol = ref<string | null>(null)
  const error = ref<string | null>(null)
  const kind = ref<TransportKind | null>(null)
  // Capability is fixed for the page's lifetime; compute once. `bleAvailability`
  // carries *why* BLE is unavailable so the Connect screen can guide the user.
  const bleAvailability = BleTransport.availability()
  const bleSupported = bleAvailability === 'available'

  const transport = shallowRef<Transport | null>(null)
  const elm = shallowRef<Elm327 | null>(null)

  let reconnector: Reconnector | null = null

  /** Bring up the ELM driver on the current transport and read the active protocol. */
  async function initElm(t: Transport): Promise<void> {
    const e = new Elm327(t)
    await e.init()
    const dpn = await e.send('ATDPN')
    elm.value?.dispose()
    elm.value = e
    label.value = t.label
    protocol.value = describeProtocol(dpn)
  }

  /**
   * On a fresh connect, start polling and recording automatically so a drive is
   * logged without anyone pressing record. Idempotent: the reconnect path
   * resumes polling and `session.start()` no-ops while already recording, so
   * this never spawns a second session. The session store is dynamically
   * imported to keep Dexie out of the initial bundle.
   */
  async function startMonitoring(): Promise<void> {
    const e = elm.value
    if (!e) return
    const live = useLiveStore()
    if (!live.polling) live.start(e, useConfigStore().specs)
    const { useSessionStore } = await import('./session')
    await useSessionStore().start()
  }

  /** Stop the recorder if it's running (best-effort; flushes the final batch). */
  async function stopRecording(): Promise<void> {
    const { useSessionStore } = await import('./session')
    const s = useSessionStore()
    if (s.recording) await s.stop()
  }

  function handleUnexpectedDisconnect(): void {
    if (status.value !== 'connected') return
    // The mock never drops unexpectedly; only auto-reconnect real BLE links.
    if (kind.value !== 'ble') {
      status.value = 'error'
      error.value = translate('errors.adapterDisconnected')
      return
    }
    const live = useLiveStore()
    const wasPolling = live.polling
    live.stop() // stop the scheduler hammering a dead link
    status.value = 'reconnecting'
    error.value = null

    reconnector?.stop()
    reconnector = new Reconnector({
      attempt: async () => {
        const t = transport.value
        if (!t) throw new Error(translate('errors.noTransport'))
        await t.connect() // reuses the permitted device — no user gesture needed
        await initElm(t)
        if (wasPolling && elm.value) live.resume(elm.value)
      },
      onStatus: (s) => {
        if (s === 'connected') {
          status.value = 'connected'
          error.value = null
        } else if (s === 'failed') {
          status.value = 'error'
          error.value = translate('errors.reconnectFailed')
          void stopRecording()
        }
      },
    })
    reconnector.start()
  }

  async function connect(which: TransportKind): Promise<void> {
    if (['connecting', 'connected', 'reconnecting'].includes(status.value)) return
    error.value = null
    status.value = 'connecting'
    kind.value = which
    try {
      const t: Transport = which === 'mock' ? new MockTransport() : new BleTransport()
      await t.connect()
      transport.value = t
      await initElm(t)
      t.onDisconnect(handleUnexpectedDisconnect)
      status.value = 'connected'
      // Best-effort — a recording hiccup must not tear down a good connection.
      try {
        await startMonitoring()
      } catch {
        // non-fatal
      }
    } catch (err) {
      status.value = 'error'
      error.value = err instanceof Error ? err.message : String(err)
      elm.value?.dispose()
      elm.value = null
      transport.value = null
    }
  }

  async function disconnect(): Promise<void> {
    reconnector?.stop()
    reconnector = null
    await stopRecording()
    useLiveStore().stop()
    elm.value?.dispose()
    await transport.value?.disconnect().catch(() => undefined)
    elm.value = null
    transport.value = null
    label.value = null
    protocol.value = null
    status.value = 'disconnected'
  }

  return {
    status,
    label,
    protocol,
    error,
    kind,
    bleSupported,
    bleAvailability,
    transport,
    elm,
    connect,
    disconnect,
  }
})
