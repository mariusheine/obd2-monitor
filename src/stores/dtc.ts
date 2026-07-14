import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { parseDtcResponse, type Dtc } from '@/obd/dtc/decode'
import type { Elm327 } from '@/obd/elm327/Elm327'
import { useDtcMonitorStore } from './dtcMonitor'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads and clears diagnostic trouble codes (Mode 03 / 07 / 0A / 04). */
export const useDtcStore = defineStore('dtc', () => {
  const stored = ref<Dtc[]>([])
  const pending = ref<Dtc[]>([])
  const permanent = ref<Dtc[]>([])
  const loading = ref(false)
  const clearing = ref(false)
  const error = ref<string | null>(null)
  const lastReadAt = ref<number | null>(null)
  const hasRead = ref(false)

  const total = computed(
    () => stored.value.length + pending.value.length + permanent.value.length,
  )

  async function readAll(elm: Elm327): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      stored.value = parseDtcResponse(await elm.send('03'), 0x03)
      pending.value = parseDtcResponse(await elm.send('07'), 0x07)
      permanent.value = parseDtcResponse(await elm.send('0A'), 0x0a)
      lastReadAt.value = Date.now()
      hasRead.value = true
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      loading.value = false
    }
  }

  /** Clear stored/pending DTCs (Mode 04) then re-read. Permanent codes are unaffected. */
  async function clear(elm: Elm327): Promise<void> {
    if (clearing.value) return
    clearing.value = true
    error.value = null
    try {
      await elm.send('04')
      // Record the deletion against any active recording (marks charts + session)
      // while the codes are still known, before re-reading the now-empty sets.
      await useDtcMonitorStore().recordManualClear()
      await readAll(elm)
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      clearing.value = false
    }
  }

  function reset(): void {
    stored.value = []
    pending.value = []
    permanent.value = []
    hasRead.value = false
    lastReadAt.value = null
    error.value = null
  }

  return {
    stored,
    pending,
    permanent,
    loading,
    clearing,
    error,
    lastReadAt,
    hasRead,
    total,
    readAll,
    clear,
    reset,
  }
})
