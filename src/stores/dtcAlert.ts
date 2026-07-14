import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { ActiveDtc } from '@/obd/dtc/monitor'

/** A newly-appeared code, stamped for the driving alert. */
export interface AppearedAlert extends ActiveDtc {
  ts: number
}

/**
 * Lightweight signal for the global "new trouble code" driving alert. Kept
 * separate from the Dexie-backed {@link ./dtcMonitor} store so App.vue (which is
 * in the initial bundle) can watch it without dragging IndexedDB into that
 * bundle. The monitor writes here; App.vue reads.
 */
export const useDtcAlertStore = defineStore('dtcAlert', () => {
  const lastAppeared = ref<AppearedAlert | null>(null)

  function signal(alert: AppearedAlert): void {
    lastAppeared.value = alert
  }
  function reset(): void {
    lastAppeared.value = null
  }

  return { lastAppeared, signal, reset }
})
